import base64, importlib.util, json, os, sys, tempfile, time, unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location("adobe_token", Path(__file__).parents[1] / "scripts" / "adobe_token.py")
at = importlib.util.module_from_spec(spec); spec.loader.exec_module(at)


def jwt(payload):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{enc({'alg': 'none'})}.{enc(payload)}.sig"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        at.CACHE_DIR = Path(self.tmp.name) / "c"; at.CACHE_FILE = at.CACHE_DIR / "token.json"
        self.env = mock.patch.dict(os.environ, {"ADOBE_CLIENT_ID": "cid", "ADOBE_CLIENT_SECRET": "sec", "ADOBE_ORG_ID": "o@AdobeOrg"}, clear=True)
        self.env.start()
    def tearDown(self):
        self.env.stop(); self.tmp.cleanup()


class JwtExpiry(unittest.TestCase):
    def test_adobe_created_at_expires_in(self):
        t = jwt({"created_at": "1000000", "expires_in": "86400000"})
        self.assertEqual(at.jwt_expiry(t), 87400.0)
    def test_exp_claim(self):
        self.assertEqual(at.jwt_expiry(jwt({"exp": 123})), 123.0)
    def test_garbage(self):
        self.assertIsNone(at.jwt_expiry("not-a-jwt"))


class Ensure(Base):
    def test_valid_session_token_is_reused_without_minting(self):
        tok = jwt({"exp": time.time() + 3600})
        os.environ["ADOBE_ACCESS_TOKEN"] = tok
        with mock.patch.object(at, "mint", side_effect=AssertionError("must not mint")):
            token, info = at.ensure(None)
        self.assertEqual(token, tok); self.assertIn("valid", info["state"])

    def test_expired_token_is_refreshed_and_cached_0600(self):
        os.environ["ADOBE_ACCESS_TOKEN"] = jwt({"exp": time.time() - 10})
        with mock.patch.object(at, "mint", return_value=("new-token", time.time() + 3600)):
            token, info = at.ensure(None)
        self.assertEqual(token, "new-token"); self.assertEqual(info["state"], "refreshed")
        self.assertEqual(oct(at.CACHE_FILE.stat().st_mode & 0o777), "0o600")
        with mock.patch.object(at, "mint", side_effect=AssertionError("must reuse cache")):
            self.assertEqual(at.ensure(None)[0], "new-token")

    def test_falls_through_to_next_source_when_secret_rejected(self):
        calls = []
        def fake_mint(creds):
            calls.append(creds["client_secret"])
            if creds["client_secret"] == "stale":
                import urllib.error, io
                raise urllib.error.HTTPError("u", 400, "bad", {}, io.BytesIO(b'{"error":"invalid_client"}'))
            return "ok-token", time.time() + 3600
        fresh_creds = {"client_id": "cid", "client_secret": "good", "org_id": "o", "scopes": ""}
        stale_creds = {"client_id": "cid", "client_secret": "stale", "org_id": "o", "scopes": ""}
        with mock.patch.object(at, "SOURCES", (("doppler", lambda p: stale_creds), ("environment", lambda p: fresh_creds))), \
             mock.patch.object(at, "mint", side_effect=fake_mint):
            token, info = at.ensure(None, force=True)
        self.assertEqual(calls, ["stale", "good"]); self.assertEqual(info["source"], "environment")

    def test_all_sources_failing_exits_nonzero_without_leaking_secret(self):
        import io, contextlib
        buf = io.StringIO()
        with mock.patch.object(at, "mint", side_effect=at.urllib.error.URLError("x")), contextlib.redirect_stderr(buf):
            with self.assertRaises(SystemExit) as cm:
                at.ensure(None, force=True)
        self.assertEqual(cm.exception.code, 2); self.assertNotIn("sec'", buf.getvalue()); self.assertNotIn("=sec", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
