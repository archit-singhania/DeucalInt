"""Runnable local profile: durable SQLite inbox, asynchronous processing, tenant-scoped API.
Start: python apps/local-api/server.py. Distributed profile is separate in compose.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from contextlib import contextmanager
import hashlib, hmac, json, math, os, random, re, secrets, signal, sqlite3, sys, threading, time
import urllib.request, urllib.error

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "ai-engine"))
from engine import (
    stamp,
    dimension,
    validate_ast,
    matches,
    sessions,
    metrics,
    funnel,
    retention,
    journeys,
    anomalies,
    experiments,
    investigate,
    percentile,
)

DB = Path(os.environ.get("DEUCALINT_DB", str(ROOT / ".data" / "deucalint.db")))
ORIGINS = set(
    os.environ.get(
        "DEUCALINT_ORIGINS",
        "http://127.0.0.1:4200,http://localhost:4200,http://127.0.0.1:8100,http://localhost:8100",
    ).split(",")
)
STOP = threading.Event()
RATES = defaultdict(deque)
RATE_LOCK = threading.Lock()
LOGIN = {}
LOGIN_LOCK = threading.Lock()
COUNTERS = Counter()
MAX_BODY = 512 * 1024
TYPES = {
    "product",
    "page",
    "session",
    "performance",
    "error",
    "network",
    "replay",
    "deployment",
    "experiment",
    "identity",
}
DISTRIBUTED = os.environ.get("DEUCALINT_PROFILE") == "distributed"
SENSITIVE = re.compile(
    r"password|passwd|secret|token|authorization|cookie|email|phone|credit|cardnumber|^cvv$|^input$|^value$|^text$|^html$|^stack$|^message$",
    re.I,
)


@contextmanager
def connect():
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    try:
        with c:
            yield c
    finally:
        c.close()


def iso(t=None):
    return (
        datetime.fromtimestamp(t if t is not None else time.time(), timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def hashed(s):
    return hashlib.sha256(s.encode()).hexdigest()


def scrub(value, depth=0):
    if depth > 8:
        return "[depth limit]"
    if isinstance(value, dict):
        return {
            str(k)[:128]: (
                "[redacted]" if SENSITIVE.search(str(k)) else scrub(v, depth + 1)
            )
            for k, v in list(value.items())[:100]
        }
    if isinstance(value, list):
        return [scrub(v, depth + 1) for v in value[:100]]
    if isinstance(value, str):
        value = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email]", value[:2000])
        value = re.sub(r"\b(?:\d[ -]*?){13,19}\b", "[number]", value)
        value = re.sub(r"(?i)bearer\s+\S+", "[credential]", value)
    return value


def validate_event(e, now=None):
    now = now or time.time()
    if not isinstance(e, dict) or set(e) - {
        "eventId",
        "schemaVersion",
        "type",
        "name",
        "timestamp",
        "anonymousId",
        "sessionId",
        "properties",
        "page",
        "context",
        "device",
    }:
        raise ValueError("Unknown event fields")
    for key in ["eventId", "name", "anonymousId", "sessionId"]:
        if not isinstance(e.get(key), str) or not 1 <= len(e[key]) <= 128:
            raise ValueError("Invalid " + key)
    if (
        type(e.get("schemaVersion")) is not int
        or e.get("schemaVersion") != 1
        or e.get("type") not in TYPES
    ):
        raise ValueError("Unsupported event schema/type")
    if not isinstance(e.get("timestamp"), str) or not re.search(
        r"(Z|[+-]\d{2}:\d{2})$", e["timestamp"]
    ):
        raise ValueError("Timestamp requires a timezone")
    t = stamp(e.get("timestamp", ""))
    if t > now + 300 or t < now - 366 * 86400:
        raise ValueError("Timestamp outside accepted window")
    for key in ["properties", "page", "context", "device"]:
        if not isinstance(e.get(key, {}), dict):
            raise ValueError("Invalid " + key)
    e = scrub(e)
    e["timestamp"] = iso(t)
    if "page" in e:
        for key in ["url", "referrer", "path"]:
            if key in e["page"]:
                e["page"][key] = str(e["page"][key]).split("?")[0].split("#")[0]
        e["page"].pop("title", None)
    for key in ["duration", "amount", "lcp", "cls", "inp", "ttfb"]:
        value = e.get("properties", {}).get(key)
        if value is not None and (
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(value)
            or value < 0
            or value > 1e12
        ):
            raise ValueError("Invalid numeric property")
    # Replay only accepts an inert geometric snapshot. No HTML or free text can cross this boundary.
    if e["type"] == "replay":
        nodes = e.get("properties", {}).get("nodes", [])
        if not isinstance(nodes, list):
            raise ValueError("Invalid replay nodes")
        safe = []
        for n in nodes[:100]:
            if not isinstance(n, dict):
                continue
            safe.append(
                {
                    "tag": (
                        n.get("tag", "div")
                        if n.get("tag")
                        in [
                            "div",
                            "button",
                            "input",
                            "img",
                            "a",
                            "p",
                            "h1",
                            "h2",
                            "header",
                            "section",
                        ]
                        else "div"
                    ),
                    **{
                        k: max(0, min(4000, float(n.get(k, 0))))
                        for k in ["x", "y", "width", "height"]
                    },
                    "masked": True,
                }
            )
        e["properties"] = {
            "nodes": safe,
            **{
                k: min(4000, max(1, float(e.get("properties", {}).get(k, default))))
                for k, default in [("width", 1440), ("height", 900)]
            },
        }
    return e


def init_db(seed=True):
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.executescript(
            """PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,project TEXT,rule TEXT,created REAL,body TEXT,acknowledged INTEGER DEFAULT 0);
        CREATE INDEX IF NOT EXISTS notification_rule ON notifications(project,rule,created);
        CREATE TABLE IF NOT EXISTS accounts(username TEXT PRIMARY KEY,salt TEXT,password TEXT);
        CREATE TABLE IF NOT EXISTS memberships(username TEXT,project TEXT,role TEXT,PRIMARY KEY(username,project));
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT,token_hash TEXT,retention INTEGER DEFAULT 90);
        CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY AUTOINCREMENT,project TEXT,event_id TEXT,body TEXT,status TEXT DEFAULT 'pending',created REAL,UNIQUE(project,event_id));
        CREATE TABLE IF NOT EXISTS events(project TEXT,event_id TEXT,session TEXT,visitor TEXT,ts REAL,body TEXT,PRIMARY KEY(project,event_id));
        CREATE INDEX IF NOT EXISTS events_time ON events(project,ts);
        CREATE TABLE IF NOT EXISTS configs(project TEXT,kind TEXT,id TEXT,body TEXT,PRIMARY KEY(project,kind,id));
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,project TEXT,action TEXT,ts TEXT);
        CREATE TABLE IF NOT EXISTS tombstones(project TEXT,kind TEXT,value TEXT,PRIMARY KEY(project,kind,value));
        """
        )
        c.execute(
            "INSERT OR IGNORE INTO projects(id,name,token_hash) VALUES(?,?,?)",
            ("demo", "Northstar Commerce", hashed("pk_demo_deucalint")),
        )
        c.execute(
            "INSERT OR IGNORE INTO projects(id,name,token_hash) VALUES(?,?,?)",
            ("sandbox", "Empty sandbox", hashed("pk_sandbox_deucalint")),
        )
        for username, password in (
            ("owner", os.environ.get("DEUCALINT_PASSWORD", "deucalint-local")),
            ("viewer", os.environ.get("DEUCALINT_VIEWER_PASSWORD", "deucalint-viewer")),
        ):
            salt = secrets.token_hex(16)
            digest = hashlib.pbkdf2_hmac(
                "sha256", password.encode(), salt.encode(), 200000
            ).hex()
            c.execute(
                "INSERT OR IGNORE INTO accounts VALUES(?,?,?)", (username, salt, digest)
            )
            for project in ("demo", "sandbox"):
                c.execute(
                    "INSERT OR IGNORE INTO memberships VALUES(?,?,?)",
                    (username, project, username),
                )
        exists = c.execute(
            "SELECT count(*) FROM events WHERE project='demo'"
        ).fetchone()[0]
        if (
            seed
            and not exists
            and not c.execute(
                "SELECT 1 FROM configs WHERE project='demo' AND kind='seed'"
            ).fetchone()
        ):
            for e in synthetic():
                c.execute(
                    "INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?)",
                    (
                        "demo",
                        e["eventId"],
                        e["sessionId"],
                        e["anonymousId"],
                        stamp(e["timestamp"]),
                        json.dumps(e),
                    ),
                )
            c.execute("INSERT OR REPLACE INTO configs VALUES('demo','seed','v1','{}')")


def synthetic(days=35):
    rng = random.Random(29)
    now = time.time()
    result = []
    for day in range(days):
        for i in range(72 + rng.randrange(35)):
            t = now - (days - 1 - day) * 86400 - rng.randrange(600, 85000)
            sid = f"demo-{day}-{i}"
            browser = rng.choice(["Chrome", "Chrome", "Safari", "Safari", "Firefox"])
            mobile = browser == "Safari" or rng.random() < 0.3
            regression = day >= days - 3 and browser == "Safari"
            visitor = f"visitor-{rng.randrange(1800)}"
            release = "web-2.8.0" if day >= days - 3 else "web-2.7.3"
            ctx = {
                "browser": browser,
                "country": rng.choice(["US", "US", "IN", "GB", "DE", "FR", "JP"]),
                "release": release,
                "source": rng.choice(["Direct", "Google", "GitHub", "Newsletter"]),
                "sample": True,
            }

            def emit(typ, name, props=None, path="/", offset=0):
                result.append(
                    {
                        "eventId": f"{sid}-{len(result)}",
                        "schemaVersion": 1,
                        "type": typ,
                        "name": name,
                        "timestamp": iso(t + offset),
                        "anonymousId": visitor,
                        "sessionId": sid,
                        "page": {"path": path},
                        "device": {"type": "mobile" if mobile else "desktop"},
                        "context": ctx,
                        "properties": props or {},
                    }
                )

            emit("page", "page_view")
            emit(
                "experiment",
                "pricing_redesign",
                {"variant": "B" if int(visitor.split("-")[1]) % 2 else "A"},
                offset=1,
            )
            if rng.random() < 0.82:
                emit("product", "product_viewed", path="/products", offset=8)
                emit("page", "page_view", path="/products", offset=9)
                if rng.random() < 0.57:
                    emit("product", "checkout_started", path="/checkout", offset=30)
                    emit("page", "page_view", path="/checkout", offset=31)
                    emit(
                        "network",
                        "POST /payments",
                        {
                            "duration": (
                                rng.randrange(1100, 2100)
                                if regression
                                else rng.randrange(180, 550)
                            ),
                            "status": 500 if regression else 200,
                        },
                        "/checkout",
                        33,
                    )
                    emit(
                        "performance",
                        "web_vital",
                        {
                            "lcp": (
                                rng.randrange(3500, 4600)
                                if regression
                                else rng.randrange(1100, 2300)
                            ),
                            "cls": round(rng.random() * 0.13, 3),
                            "inp": rng.randrange(80, 350),
                            "ttfb": rng.randrange(80, 400),
                        },
                        "/checkout",
                        34,
                    )
                    if rng.random() < (0.25 if regression else 0.81):
                        emit(
                            "product",
                            "purchase_completed",
                            {"amount": rng.choice([49, 79, 129])},
                            "/thank-you",
                            55,
                        )
                    elif regression:
                        emit(
                            "error",
                            "PaymentFormError",
                            {"fingerprint": "payment-form-v1"},
                            "/checkout",
                            35,
                        )
                        emit(
                            "replay",
                            "snapshot",
                            {
                                "width": 1000,
                                "nodes": [
                                    {
                                        "tag": "header",
                                        "x": 30,
                                        "y": 25,
                                        "width": 940,
                                        "height": 70,
                                    },
                                    {
                                        "tag": "h1",
                                        "x": 80,
                                        "y": 140,
                                        "width": 420,
                                        "height": 50,
                                    },
                                    {
                                        "tag": "input",
                                        "x": 80,
                                        "y": 230,
                                        "width": 500,
                                        "height": 60,
                                    },
                                    {
                                        "tag": "button",
                                        "x": 80,
                                        "y": 330,
                                        "width": 230,
                                        "height": 55,
                                    },
                                ],
                            },
                            "/checkout",
                            36,
                        )
    result.append(
        {
            "eventId": "demo-deployment",
            "schemaVersion": 1,
            "type": "deployment",
            "name": "release_published",
            "timestamp": iso(now - 3 * 86400),
            "anonymousId": "deploy-bot",
            "sessionId": "deployment-2.8",
            "context": {"release": "web-2.8.0", "sample": True},
            "properties": {"sha": "a8f4d21", "environment": "production"},
        }
    )
    return result


def consume_once():
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM inbox WHERE status='pending' ORDER BY id LIMIT 250"
        ).fetchall()
        for row in rows:
            try:
                e = json.loads(row["body"])
                project = row["project"]
                tomb = c.execute(
                    "SELECT 1 FROM tombstones WHERE project=? AND ((kind=? AND value=?) OR (kind=? AND value=?))",
                    (project, "visitor", e["anonymousId"], "session", e["sessionId"]),
                ).fetchone()
                policy = c.execute(
                    "SELECT retention FROM projects WHERE id=?", (project,)
                ).fetchone()
                if (
                    not tomb
                    and policy
                    and stamp(e["timestamp"])
                    >= time.time() - policy["retention"] * 86400
                ):
                    c.execute(
                        "INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?)",
                        (
                            project,
                            e["eventId"],
                            e["sessionId"],
                            e["anonymousId"],
                            stamp(e["timestamp"]),
                            row["body"],
                        ),
                    )
                c.execute("UPDATE inbox SET status='done' WHERE id=?", (row["id"],))
                COUNTERS["processed"] += 1
            except (ValueError, KeyError, TypeError):
                c.execute(
                    "UPDATE inbox SET status='deadletter' WHERE id=?", (row["id"],)
                )
                COUNTERS["deadletter"] += 1
        return len(rows)


def evaluate_alerts(now=None):
    """One local evaluator; durable cooldown survives worker restarts."""
    if DISTRIBUTED:
        return
    now = time.time() if now is None else now
    with connect() as c:
        rules = [
            (r[0], json.loads(r[1]))
            for r in c.execute("SELECT project,body FROM configs WHERE kind='alerts'")
        ]
    cache = {}
    for project, rule in rules:
        if project not in cache:
            cache[project] = metrics(read_events(project, 1))
        m = cache[project]
        value = m[rule["metric"]]
        triggered = (
            value < rule["threshold"]
            if rule["metric"] == "conversion"
            else value > rule["threshold"]
        )
        if not triggered or m["sessions"] < rule.get("minimumSessions", 20):
            continue
        with connect() as c:
            c.execute("BEGIN IMMEDIATE")
            recent = c.execute(
                "SELECT 1 FROM notifications WHERE project=? AND rule=? AND created>?",
                (project, rule["id"], now - rule.get("cooldownMinutes", 60) * 60),
            ).fetchone()
            if recent:
                continue
            payload = {
                "metric": rule["metric"],
                "value": value,
                "threshold": rule["threshold"],
                "sessions": m["sessions"],
                "windowHours": 24,
            }
            c.execute(
                "INSERT INTO notifications(id,project,rule,created,body) VALUES(?,?,?,?,?)",
                (secrets.token_hex(12), project, rule["id"], now, json.dumps(payload)),
            )
    with connect() as c:
        c.execute("DELETE FROM notifications WHERE created<?", (now - 90 * 86400,))


def worker():
    last = 0
    while not STOP.wait(0.25):
        try:
            consume_once()
            if time.time() - last > 60:
                with connect() as c:
                    for p in c.execute("SELECT id,retention FROM projects").fetchall():
                        c.execute(
                            "DELETE FROM events WHERE project=? AND ts<?",
                            (p["id"], time.time() - p["retention"] * 86400),
                        )
                    c.execute(
                        "DELETE FROM inbox WHERE status='done' AND created<?",
                        (time.time() - 86400,),
                    )
                evaluate_alerts()
                last = time.time()
        except sqlite3.Error:
            COUNTERS["worker_failures"] += 1


def read_events(project, days=30, ast=None):
    if DISTRIBUTED:
        tokens = json.loads(os.environ.get("DEUCALINT_QUERY_TOKENS", "{}"))
        if project not in tokens:
            raise PermissionError("No warehouse credential configured for this project")
        request = urllib.request.Request(
            os.environ.get("DEUCALINT_ANALYTICS_URL", "http://analytics-api:8080")
            + "/v1/events?days="
            + str(days),
            headers={"Authorization": "Bearer " + tokens[project]},
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            rows = json.load(response)["data"]
        if len(rows) > 100000:
            raise ValueError("Query limit reached; shorten the time range")
        es = [json.loads(row["body"]) for row in rows]
        return [e for e in es if matches(e, ast)] if ast else es
    with connect() as c:
        rows = c.execute(
            "SELECT body FROM events WHERE project=? AND ts>=? AND ts<=? ORDER BY ts LIMIT 100001",
            (project, time.time() - days * 86400, time.time()),
        ).fetchall()
    if len(rows) > 100000:
        raise ValueError("Local query limit reached; shorten the time range")
    es = [json.loads(r["body"]) for r in rows]
    return [e for e in es if matches(e, ast)] if ast else es


def overview(project, days=7, ast=None):
    events = read_events(project, days * 2, ast)
    now = time.time()
    cutoff = now - days * 86400
    current = [e for e in events if stamp(e["timestamp"]) >= cutoff]
    previous = [e for e in events if stamp(e["timestamp"]) < cutoff]
    groups = defaultdict(list)
    buckets = 24 if days == 1 else days
    width = days * 86400 / buckets
    for e in current:
        groups[min(buckets - 1, int((stamp(e["timestamp"]) - cutoff) / width))].append(
            e
        )
    series = [
        {
            "label": datetime.fromtimestamp(cutoff + i * width, timezone.utc).strftime(
                "%H:%M" if days == 1 else "%b %d"
            ),
            **metrics(groups[i]),
        }
        for i in range(buckets)
    ]
    previous_groups = defaultdict(list)
    for e in previous:
        index = max(
            0,
            min(
                buckets - 1,
                int((stamp(e["timestamp"]) - (cutoff - days * 86400)) / width),
            ),
        )
        previous_groups[index].append(e)
    previous_series = [
        {"label": series[i]["label"], **metrics(previous_groups[i])}
        for i in range(buckets)
    ]
    distributions = {
        key: [
            {"name": name, "count": n}
            for name, n in Counter(
                dimension(es[0], key) for es in sessions(current).values()
            ).most_common(7)
        ]
        for key in ["browser", "device", "country"]
    }
    return {
        "metrics": metrics(current),
        "previous": metrics(previous),
        "series": series,
        "previousSeries": previous_series,
        "distributions": distributions,
        "pages": [
            {"name": p, "count": n}
            for p, n in Counter(
                dimension(e, "path") for e in current if e["type"] == "page"
            ).most_common(7)
        ],
        "sample": any(e.get("context", {}).get("sample") for e in current),
        "updatedAt": iso(),
        "project": project,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def send(self, status, data, headers=None, ctype="application/json"):
        raw = (
            json.dumps(data, allow_nan=False).encode()
            if ctype == "application/json"
            else data.encode() if isinstance(data, str) else data
        )
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        if self.headers.get("Origin") in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_BODY:
            raise OverflowError("Payload exceeds 512 KiB")
        if length < 1:
            raise ValueError("JSON body required")
        return json.loads(
            self.rfile.read(length),
            parse_constant=lambda x: (_ for _ in ()).throw(
                ValueError("Invalid number")
            ),
        )

    def user(self):
        cookie = next(
            (
                part.strip()[3:]
                for part in self.headers.get("Cookie", "").split(";")
                if part.strip().startswith("di=")
            ),
            None,
        )
        with LOGIN_LOCK:
            user = LOGIN.get(cookie)
            if user and user["expires"] < time.time():
                LOGIN.pop(cookie, None)
                user = None
        if not user:
            raise PermissionError("Sign in to continue")
        user = dict(user)
        if not DISTRIBUTED:
            with connect() as c:
                memberships = c.execute(
                    "SELECT project,role FROM memberships WHERE username=?",
                    (user.get("username", user["role"]),),
                ).fetchall()
            user["memberships"] = {r["project"]: r["role"] for r in memberships}
            user["projects"] = list(user["memberships"])
        return user

    def limited(self, key, limit):
        with RATE_LOCK:
            now = time.time()
            q = RATES[key]
            while q and q[0] < now - 60:
                q.popleft()
            if len(q) >= limit:
                return True
            q.append(now)
        return False

    def do_OPTIONS(self):
        self.send(
            204,
            b"",
            {
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
            },
            "text/plain",
        )

    def do_GET(self):
        self.handle_request("GET")

    def do_POST(self):
        self.handle_request("POST")

    def do_DELETE(self):
        self.handle_request("DELETE")

    def handle_request(self, method):
        started = time.perf_counter()
        try:
            self.route(method)
        except PermissionError as e:
            self.send(
                401 if str(e) == "Sign in to continue" else 403, {"error": str(e)}
            )
        except OverflowError as e:
            self.send(413, {"error": str(e)})
        except (ValueError, KeyError, TypeError) as e:
            self.send(400, {"error": str(e)[:200]})
        except (urllib.error.URLError, TimeoutError):
            self.send(
                503,
                {"error": "A platform dependency is unavailable; try again shortly"},
            )
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as e:
            print("Request failed:", type(e).__name__, str(e), file=sys.stderr)
            self.send(500, {"error": "Internal server error"})
        finally:
            COUNTERS["requests"] += 1
            COUNTERS["request_ms_sum"] += (time.perf_counter() - started) * 1000

    def route(self, method):
        url = urlparse(self.path)
        path = url.path
        q = parse_qs(url.query)
        if (
            method in ("POST", "DELETE")
            and self.headers.get("Origin")
            and self.headers["Origin"] not in ORIGINS
        ):
            raise PermissionError("Origin is not allowed")
        if path == "/health":
            return self.send(
                200,
                {
                    "status": "ok",
                    "profile": "distributed" if DISTRIBUTED else "local",
                    "queue": "Redpanda" if DISTRIBUTED else "durable SQLite inbox",
                },
            )
        if path == "/metrics":
            # Bound to loopback in local mode; proxy does not publish this endpoint in containers.
            with connect() as c:
                pending = c.execute(
                    "SELECT count(*) FROM inbox WHERE status='pending'"
                ).fetchone()[0]
            return self.send(
                200,
                "\n".join(
                    f"deucalint_{k} {v}"
                    for k, v in {**COUNTERS, "queue_pending": pending}.items()
                )
                + "\n",
                ctype="text/plain",
            )
        if path == "/api/login" and method == "POST":
            if self.limited("login:" + self.client_address[0], 20):
                return self.send(429, {"error": "Too many login attempts"})
            data = self.body()
            username = str(data.get("username", data.get("role", "owner")))
            password = str(data.get("password", ""))
            with connect() as c:
                account = c.execute(
                    "SELECT * FROM accounts WHERE username=?", (username,)
                ).fetchone()
                memberships = c.execute(
                    "SELECT project,role FROM memberships WHERE username=?", (username,)
                ).fetchall()
            if not account or not hmac.compare_digest(
                hashlib.pbkdf2_hmac(
                    "sha256", password.encode(), account["salt"].encode(), 200000
                ).hex(),
                account["password"],
            ):
                raise PermissionError("Invalid credentials")
            role = memberships[0]["role"] if memberships else "viewer"
            token = secrets.token_urlsafe(32)
            with LOGIN_LOCK:
                LOGIN[token] = {
                    "role": role,
                    "username": username,
                    "projects": (
                        list(json.loads(os.environ.get("DEUCALINT_QUERY_TOKENS", "{}")))
                        if DISTRIBUTED
                        else ["demo", "sandbox"]
                    ),
                    "expires": time.time() + 8 * 3600,
                }
            return self.send(
                200,
                {"role": role},
                {
                    "Set-Cookie": f"di={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800"
                },
            )
        if path == "/v1/batch" and method == "POST":
            data = self.body()
            if not isinstance(data, dict):
                raise ValueError("Batch must be an object")
            if DISTRIBUTED:
                request = urllib.request.Request(
                    os.environ.get("DEUCALINT_COLLECTOR_URL", "http://collector:8080")
                    + "/v1/batch",
                    data=json.dumps(data).encode(),
                    headers={"Content-Type": "application/json"},
                )
                try:
                    with urllib.request.urlopen(request, timeout=40) as response:
                        return self.send(response.status, json.load(response))
                except urllib.error.HTTPError as e:
                    try:
                        return self.send(
                            e.code,
                            {"error": "Distributed collector rejected this batch"},
                        )
                    finally:
                        e.close()
            with connect() as c:
                p = c.execute(
                    "SELECT * FROM projects WHERE token_hash=?",
                    (hashed(str(data.get("projectToken", ""))),),
                ).fetchone()
            if not p:
                raise PermissionError("Invalid ingestion token")
            if self.limited("ingest:" + p["id"], 120):
                return self.send(
                    429, {"error": "Project rate limit exceeded"}, {"Retry-After": "60"}
                )
            es = data.get("events")
            if not isinstance(es, list) or not 1 <= len(es) <= 100:
                raise ValueError("Batch requires 1–100 events")
            valid = [validate_event(e) for e in es]
            accepted = 0
            with connect() as c:
                for e in valid:
                    if c.execute(
                        "SELECT 1 FROM events WHERE project=? AND event_id=?",
                        (p["id"], e["eventId"]),
                    ).fetchone():
                        continue
                    accepted += c.execute(
                        "INSERT OR IGNORE INTO inbox(project,event_id,body,created) VALUES(?,?,?,?)",
                        (p["id"], e["eventId"], json.dumps(e), time.time()),
                    ).rowcount
            COUNTERS["received"] += len(valid)
            return self.send(
                202, {"accepted": accepted, "duplicates": len(valid) - accepted}
            )
        if not path.startswith("/api/"):
            asset = ROOT / "dist" / "dashboard" / path.lstrip("/")
            if not asset.resolve().is_relative_to(
                (ROOT / "dist" / "dashboard").resolve()
            ):
                raise PermissionError("Invalid path")
            if not asset.is_file():
                asset = ROOT / "dist" / "dashboard" / "index.html"
            if asset.is_file():
                import mimetypes

                return self.send(
                    200,
                    asset.read_bytes(),
                    ctype=mimetypes.guess_type(asset.name)[0]
                    or "application/octet-stream",
                )
            return self.send(
                404,
                {"error": "Run npm run dev or npm run build to serve the dashboard"},
            )
        user = self.user()
        if path == "/api/logout":
            cookie = next(
                (
                    part.strip()[3:]
                    for part in self.headers.get("Cookie", "").split(";")
                    if part.strip().startswith("di=")
                ),
                None,
            )
            with LOGIN_LOCK:
                LOGIN.pop(cookie, None)
            return self.send(
                200,
                {"ok": True},
                {"Set-Cookie": "di=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"},
            )
        if path == "/api/me":
            return self.send(200, {"role": user["role"]})
        if path == "/api/projects" and method == "POST":
            if DISTRIBUTED:
                return self.send(
                    501,
                    {
                        "error": "Project provisioning requires distributed control-plane support"
                    },
                )
            if "owner" not in user.get("memberships", {}).values():
                raise PermissionError("Owner role required")
            name = str(self.body().get("name", "")).strip()
            if not 2 <= len(name) <= 80:
                raise ValueError("Project name must contain 2–80 characters")
            pid = secrets.token_hex(8)
            token = "pk_" + secrets.token_urlsafe(24)
            with connect() as c:
                c.execute(
                    "INSERT INTO projects(id,name,token_hash) VALUES(?,?,?)",
                    (pid, name, hashed(token)),
                )
                c.execute(
                    "INSERT INTO memberships VALUES(?,?,?)",
                    (user["username"], pid, "owner"),
                )
            return self.send(201, {"id": pid, "token": token})
        if path == "/api/projects":
            with connect() as c:
                rows = [
                    dict(r)
                    for r in c.execute(
                        "SELECT id,name,retention FROM projects"
                    ).fetchall()
                    if r["id"] in user["projects"]
                ]
            for row in rows:
                row["role"] = user.get("memberships", {}).get(row["id"], user["role"])
            return self.send(200, rows)
        project = q.get("project", ["demo"])[0]
        if project not in user["projects"]:
            raise PermissionError("Project access denied")
        user["role"] = user.get("memberships", {}).get(project, user["role"])
        allowed = (
            ("owner", "admin", "analyst")
            if path in ("/api/reports", "/api/alerts", "/api/notifications")
            else ("owner", "admin")
        )
        if (
            method != "GET"
            and path != "/api/investigate"
            and user["role"] not in allowed
        ):
            raise PermissionError("Insufficient project role")
        if path == "/api/members":
            if DISTRIBUTED:
                return self.send(
                    501,
                    {"error": "Distributed membership management is not implemented"},
                )
            with connect() as c:
                if method == "POST":
                    data = self.body()
                    name = str(data.get("username", "")).strip()
                    password = str(data.get("password", ""))
                    role = data.get("role")
                    if (
                        not 3 <= len(name) <= 64
                        or not name.replace("_", "").replace("-", "").isalnum()
                        or role not in ("admin", "developer", "analyst", "viewer")
                    ):
                        raise ValueError("Invalid username or role")
                    exists = c.execute(
                        "SELECT 1 FROM accounts WHERE username=?", (name,)
                    ).fetchone()
                    if exists:
                        raise ValueError(
                            "Username already exists; account linking is not supported"
                        )
                    if len(password) < 12:
                        raise ValueError("Password requires at least 12 characters")
                    salt = secrets.token_hex(16)
                    digest = hashlib.pbkdf2_hmac(
                        "sha256", password.encode(), salt.encode(), 200000
                    ).hex()
                    c.execute(
                        "INSERT INTO accounts VALUES(?,?,?)", (name, salt, digest)
                    )
                    c.execute(
                        "INSERT INTO memberships VALUES(?,?,?)", (name, project, role)
                    )
                    c.execute(
                        "INSERT INTO audit(project,action,ts) VALUES(?,?,?)",
                        (project, "member.created:" + name, iso()),
                    )
                elif method == "DELETE":
                    name = str(self.body().get("id", ""))
                    member = c.execute(
                        "SELECT role FROM memberships WHERE username=? AND project=?",
                        (name, project),
                    ).fetchone()
                    if member and member["role"] == "owner":
                        raise ValueError("Owner access cannot be removed")
                    c.execute(
                        "DELETE FROM memberships WHERE username=? AND project=?",
                        (name, project),
                    )
                    c.execute(
                        "INSERT INTO audit(project,action,ts) VALUES(?,?,?)",
                        (project, "member.removed:" + name, iso()),
                    )
                rows = [
                    dict(r)
                    for r in c.execute(
                        "SELECT username AS id,username,role FROM memberships WHERE project=?",
                        (project,),
                    )
                ]
            return self.send(200, rows)
        if (
            DISTRIBUTED
            and method != "GET"
            and path in ("/api/settings", "/api/token", "/api/lifecycle")
        ):
            return self.send(
                501,
                {
                    "error": "This management action is implemented in the local profile only. Distributed lifecycle and rotation APIs are not yet available."
                },
            )
        days = int(q.get("days", ["7"])[0])
        if not 1 <= days <= 90:
            raise ValueError("Days must be 1–90")
        ast = validate_ast(json.loads(q["segment"][0])) if "segment" in q else None
        if path == "/api/notifications":
            with connect() as c:
                if method == "POST":
                    c.execute(
                        "UPDATE notifications SET acknowledged=1 WHERE project=? AND id=?",
                        (project, str(self.body().get("id", ""))),
                    )
                rows = [
                    {
                        **json.loads(r["body"]),
                        "id": r["id"],
                        "createdAt": iso(r["created"]),
                        "acknowledged": bool(r["acknowledged"]),
                    }
                    for r in c.execute(
                        "SELECT * FROM notifications WHERE project=? ORDER BY created DESC LIMIT 100",
                        (project,),
                    )
                ]
            return self.send(200, rows)
        if path == "/api/investigations":
            with connect() as c:
                rows = [
                    json.loads(r[0])
                    for r in c.execute(
                        "SELECT body FROM configs WHERE project=? AND kind='investigation' ORDER BY rowid DESC LIMIT 20",
                        (project,),
                    )
                ]
            return self.send(200, rows)
        if path == "/api/insights":
            summary = overview(project, days, ast)
            return self.send(
                200,
                {
                    "sessions": summary["metrics"]["sessions"],
                    "errors": summary["metrics"]["errors"],
                    "updatedAt": summary["updatedAt"],
                    "sample": summary["sample"],
                },
            )
        if path == "/api/overview":
            return self.send(200, overview(project, days, ast))
        if path == "/api/live":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            COUNTERS["sse_active"] += 1
            try:
                for _ in range(300):
                    if STOP.is_set():
                        break
                    try:
                        self.user()
                    except PermissionError:
                        break
                    es = read_events(project, 5 / 1440)
                    payload = {
                        "active": len({e["anonymousId"] for e in es}),
                        "events": es[-15:][::-1],
                        "timestamp": iso(),
                    }
                    self.wfile.write(("data: " + json.dumps(payload) + "\n\n").encode())
                    self.wfile.flush()
                    STOP.wait(2)
            finally:
                COUNTERS["sse_active"] -= 1
            self.close_connection = True
            return
        if path == "/api/settings":
            with connect() as c:
                if method == "POST":
                    data = self.body()
                    value = int(data["retention"])
                    if value not in (7, 30, 90, 180, 365):
                        raise ValueError("Invalid retention")
                    c.execute(
                        "UPDATE projects SET retention=? WHERE id=?", (value, project)
                    )
                    c.execute(
                        "INSERT INTO audit(project,action,ts) VALUES(?,?,?)",
                        (project, "retention.updated", iso()),
                    )
                p = dict(
                    c.execute(
                        "SELECT id,name,retention FROM projects WHERE id=?", (project,)
                    ).fetchone()
                )
            return self.send(200, p)
        if path == "/api/token" and method == "POST":
            token = "pk_" + secrets.token_urlsafe(24)
            with connect() as c:
                c.execute(
                    "UPDATE projects SET token_hash=? WHERE id=?",
                    (hashed(token), project),
                )
                c.execute(
                    "INSERT INTO audit(project,action,ts) VALUES(?,?,?)",
                    (project, "token.rotated", iso()),
                )
            return self.send(200, {"token": token})
        if path == "/api/lifecycle" and method == "DELETE":
            data = self.body()
            kind = data["kind"]
            value = str(data.get("value", ""))
            if kind not in ("visitor", "session") or not value:
                raise ValueError("Provide a visitor or session ID")
            with connect() as c:
                c.execute(
                    "INSERT OR IGNORE INTO tombstones VALUES(?,?,?)",
                    (project, kind, value),
                )
                deleted = c.execute(
                    "DELETE FROM events WHERE project=? AND " + kind + "=?",
                    (project, value),
                ).rowcount
                # Purge raw copies too; tombstones block in-flight or repeated deliveries.
                c.execute(
                    "DELETE FROM inbox WHERE project=? AND json_extract(body,?)=?",
                    (
                        project,
                        "$.anonymousId" if kind == "visitor" else "$.sessionId",
                        value,
                    ),
                )
                c.execute(
                    "INSERT INTO audit(project,action,ts) VALUES(?,?,?)",
                    (project, f"{kind}.deleted", iso()),
                )
            return self.send(200, {"deleted": deleted})
        if path in ("/api/alerts", "/api/reports"):
            kind = path.rsplit("/", 1)[1]
            with connect() as c:
                if method == "POST":
                    data = self.body()
                    if kind == "alerts":
                        if (
                            data.get("metric")
                            not in ("errors", "conversion", "latency")
                            or not isinstance(data.get("threshold"), (int, float))
                            or not 0 <= data["threshold"] <= 1e9
                        ):
                            raise ValueError("Invalid alert rule")
                        minimum = int(data.get("minimumSessions", 20))
                        cooldown = int(data.get("cooldownMinutes", 60))
                        if not 1 <= minimum <= 1000000 or not 1 <= cooldown <= 10080:
                            raise ValueError("Invalid sample minimum or cooldown")
                        data = {k: data[k] for k in ("metric", "threshold")}
                        data.update(minimumSessions=minimum, cooldownMinutes=cooldown)
                        data["id"] = secrets.token_hex(8)
                    else:
                        validate_ast(data.get("segment", {"and": []}))
                        data = {
                            "id": secrets.token_hex(8),
                            "name": str(data.get("name", "Saved report"))[:80],
                            "segment": data.get("segment", {"and": []}),
                        }
                    c.execute(
                        "INSERT INTO configs VALUES(?,?,?,?)",
                        (project, kind, data["id"], json.dumps(data)),
                    )
                if method == "DELETE":
                    c.execute(
                        "DELETE FROM configs WHERE project=? AND kind=? AND id=?",
                        (project, kind, self.body()["id"]),
                    )
                rows = [
                    json.loads(r["body"])
                    for r in c.execute(
                        "SELECT body FROM configs WHERE project=? AND kind=?",
                        (project, kind),
                    )
                ]
            if kind == "alerts":
                m = metrics(read_events(project, 1))
                for r in rows:
                    r["current"] = m[r["metric"]]
                    r["insufficientSample"] = m["sessions"] < r.get(
                        "minimumSessions", 20
                    )
                    r["triggered"] = not r["insufficientSample"] and (
                        r["current"] > r["threshold"]
                        if r["metric"] != "conversion"
                        else r["current"] < r["threshold"]
                    )
            return self.send(200, rows)
        if path == "/api/audit":
            with connect() as c:
                rows = [
                    dict(r)
                    for r in c.execute(
                        "SELECT action,ts FROM audit WHERE project=? ORDER BY id DESC LIMIT 50",
                        (project,),
                    )
                ]
            return self.send(200, rows)
        es = read_events(project, days, ast)
        if path == "/api/export":
            return self.send(
                200,
                es,
                {"Content-Disposition": 'attachment; filename="deucalint-events.json"'},
            )
        if path == "/api/funnels":
            return self.send(
                200,
                funnel(
                    es,
                    json.loads(q["steps"][0]) if "steps" in q else None,
                    int(q.get("window", ["1800"])[0]),
                    q.get("ordered", ["true"])[0] == "true",
                ),
            )
        if path == "/api/retention":
            return self.send(200, retention(es, time.time()))
        if path == "/api/journeys":
            return self.send(200, journeys(es))
        if path == "/api/experiments":
            return self.send(200, experiments(es))
        if path == "/api/anomalies":
            return self.send(
                200, anomalies(overview(project, max(days, 14), ast)["series"])
            )
        if path == "/api/investigate" and method == "POST":
            data = self.body()
            question = str(data.get("question", ""))[:500]
            if not any(
                term in question.lower()
                for term in (
                    "conversion",
                    "checkout",
                    "error",
                    "latency",
                    "changed",
                    "deployment",
                    "drop",
                )
            ):
                return self.send(
                    200,
                    {
                        "unsupported": True,
                        "summary": "Ask about checkout conversion, errors, latency, or deployment changes. The local engine supports these investigations.",
                    },
                )
            lower = question.lower()
            focus = (
                "query_errors"
                if "error" in lower
                else (
                    "query_performance"
                    if "latency" in lower
                    else (
                        "query_deployments"
                        if "deployment" in lower
                        else "compare_metrics"
                    )
                )
            )
            planner_mode = "deterministic"
            planned_segment = {"and": []}
            if os.environ.get("DEUCALINT_AI_URL"):
                req = urllib.request.Request(
                    os.environ["DEUCALINT_AI_URL"].rstrip("/") + "/plan",
                    data=json.dumps({"question": question}).encode(),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": "Bearer "
                        + os.environ.get("AI_SERVICE_TOKEN", ""),
                    },
                )
                with urllib.request.urlopen(req, timeout=35) as response:
                    plan = json.load(response)
                if plan.get("tool") not in (
                    "compare_metrics",
                    "query_errors",
                    "query_performance",
                    "query_deployments",
                ):
                    raise ValueError("Unsupported AI tool")
                focus = plan["tool"]
                planned_segment = validate_ast(plan.get("segment", {"and": []}))
                planner_mode = plan.get("mode", "deterministic")
            else:
                for name in ("Safari", "Chrome", "Firefox"):
                    if name.lower() in lower:
                        planned_segment = {
                            "dimension": "browser",
                            "operator": "eq",
                            "value": name,
                        }
                        break
            es = [e for e in es if matches(e, planned_segment)]
            result = investigate(es, time.time() - days * 86400, time.time(), focus)
            result["question"] = question
            result["plan"] = {
                "tool": focus,
                "segment": planned_segment,
                "project": project,
            }
            result["trace"] = [
                "authorize_project",
                "validate_segment",
                "query_events",
                focus,
                "rank_correlated_contributors",
                "attach_evidence",
            ]
            if planner_mode == "ollama":
                result["mode"] = "Ollama tool planner + deterministic evidence engine"
            with connect() as c:
                item = {
                    "id": secrets.token_hex(8),
                    "question": question,
                    "createdAt": iso(),
                    "result": result,
                }
                c.execute(
                    "INSERT INTO configs VALUES(?,?,?,?)",
                    (project, "investigation", item["id"], json.dumps(item)),
                )
                c.execute(
                    "DELETE FROM configs WHERE project=? AND kind='investigation' AND rowid NOT IN (SELECT rowid FROM configs WHERE project=? AND kind='investigation' ORDER BY rowid DESC LIMIT 20)",
                    (project, project),
                )
            return self.send(200, result)
        if path == "/api/sessions":
            rows = []
            for sid, group in sessions(es).items():
                rows.append(
                    {
                        "id": sid,
                        "visitor": group[0]["anonymousId"],
                        "browser": dimension(group[0], "browser"),
                        "device": dimension(group[0], "device"),
                        "country": dimension(group[0], "country"),
                        "started": group[0]["timestamp"],
                        "events": len(group),
                        "errors": sum(e["type"] == "error" for e in group),
                        "duration": round(
                            stamp(group[-1]["timestamp"]) - stamp(group[0]["timestamp"])
                        ),
                        "replay": any(e["type"] == "replay" for e in group),
                    }
                )
            return self.send(
                200, sorted(rows, key=lambda r: r["started"], reverse=True)[:100]
            )
        if path == "/api/session":
            return self.send(
                200, [e for e in es if e["sessionId"] == q.get("id", [""])[0]]
            )
        if path == "/api/observability":
            errors = Counter(e["name"] for e in es if e["type"] == "error")
            network = defaultdict(list)
            for e in es:
                if e["type"] == "network":
                    network[e["name"]].append(e)
            vitals = {
                k: percentile(
                    [
                        e.get("properties", {}).get(k, 0)
                        for e in es
                        if e["type"] == "performance"
                    ],
                    0.75,
                )
                for k in ["lcp", "cls", "inp", "ttfb"]
            }
            return self.send(
                200,
                {
                    "errors": [
                        {"name": n, "count": c} for n, c in errors.most_common(20)
                    ],
                    "vitals": vitals,
                    "network": [
                        {
                            "name": n,
                            "requests": len(v),
                            "p95": percentile(
                                [e.get("properties", {}).get("duration", 0) for e in v]
                            ),
                            "failed": sum(
                                e.get("properties", {}).get("status", 200) >= 400
                                for e in v
                            ),
                        }
                        for n, v in network.items()
                    ],
                    "deployments": [e for e in es if e["type"] == "deployment"],
                },
            )
        return self.send(404, {"error": "Endpoint not found"})


def main():
    init_db("--no-seed" not in sys.argv and not DISTRIBUTED)
    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    server = ThreadingHTTPServer(
        (
            os.environ.get("DEUCALINT_HOST", "127.0.0.1"),
            int(os.environ.get("PORT", "8100")),
        ),
        Handler,
    )
    server.daemon_threads = True
    print("DeucalInt local API: http://127.0.0.1:8100", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STOP.set()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
