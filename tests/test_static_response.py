import io, json, unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "local-api"))
import server


class StaticResponseTests(unittest.TestCase):
    def test_preencoded_json_static_asset_is_not_serialized_twice(self):
        handler = object.__new__(server.Handler)
        handler.wfile = io.BytesIO()
        handler.headers = {}
        headers = {}
        handler.send_response = lambda status: None
        handler.send_header = lambda key, value: headers.update({key: value})
        handler.end_headers = lambda: None
        raw = b'[{"id":"US","name":"United States"}]'
        with patch.object(server, "secure_cookies", return_value=False):
            handler.send(200, raw, ctype="application/json")
        self.assertEqual(json.loads(handler.wfile.getvalue())[0]["id"], "US")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(int(headers["Content-Length"]), len(raw))
