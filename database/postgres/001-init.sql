CREATE TABLE organizations(id text PRIMARY KEY,name text NOT NULL);
CREATE TABLE projects(id text PRIMARY KEY,organization_id text REFERENCES organizations(id),name text NOT NULL,retention_days integer DEFAULT 90 CHECK(retention_days IN(7,30,90,180,365)));
CREATE TABLE project_tokens(id bigserial PRIMARY KEY,project_id text REFERENCES projects(id),token_hash text UNIQUE NOT NULL,scope text NOT NULL CHECK(scope IN('events:write','analytics:read')),revoked boolean DEFAULT false);
CREATE TABLE organization_members(user_id text,organization_id text REFERENCES organizations(id),role text CHECK(role IN('owner','admin','developer','analyst','viewer')),PRIMARY KEY(user_id,organization_id));
CREATE TABLE saved_reports(id text PRIMARY KEY,project_id text REFERENCES projects(id),definition jsonb NOT NULL);
CREATE TABLE alerts(id text PRIMARY KEY,project_id text REFERENCES projects(id),definition jsonb NOT NULL);
CREATE TABLE audit_logs(id bigserial PRIMARY KEY,project_id text,action text,created_at timestamptz DEFAULT now());
INSERT INTO organizations VALUES('local','Local development');
INSERT INTO projects(id,organization_id,name) VALUES('demo','local','Northstar Commerce');
-- Seed development tokens as hashes. Rotate before any remote deployment.
INSERT INTO project_tokens(project_id,token_hash,scope) VALUES
('demo',encode(sha256('pk_demo_deucalint'::bytea),'hex'),'events:write'),
('demo',encode(sha256('sk_local_deucalint'::bytea),'hex'),'analytics:read');
