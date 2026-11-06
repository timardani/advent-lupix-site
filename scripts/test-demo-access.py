#!/usr/bin/env python3
"""A lezárt bemutatók nyilvános tiltásának és tulajdonosi hozzáférésének tesztje."""
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("vezerlo_api", ROOT / "vezerlo-api.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class DemoAccessTest(unittest.TestCase):
    def setUp(self):
        self.releases = Mock()
        self.releases.read_text.return_value = json.dumps({
            "demok": [{"demo": "bolt", "slug": "bolt-abcdef"}]
        })
        self.shops = [{"id": "bolt", "allapot": "kikuldve"}]
        p1 = patch.object(api, "RELEASES", self.releases)
        p2 = patch.object(api, "load_data", side_effect=lambda: {"boltok": self.shops})
        p1.start()
        p2.start()
        self.addCleanup(p1.stop)
        self.addCleanup(p2.stop)

    def test_open_and_closed_status_changes_without_deploy(self):
        uri = "/bolt-abcdef/?bemutato=1"
        self.assertTrue(api.demo_access(uri, False))
        for status in ("lezart", "nem", "lejart", "kizart"):
            self.shops[0]["allapot"] = status
            self.assertFalse(api.demo_access(uri, False), status)
            self.assertFalse(api.demo_access("/bolt-abcdef/assets/app.js", False), status)
            self.assertFalse(api.demo_access("/api/kal/bolt-abcdef/napok", False), status)
            self.assertTrue(api.demo_access(uri, True), status)
            self.assertTrue(api.demo_access("/bolt-abcdef/products/01.webp", True), status)
            self.assertTrue(api.demo_access("/api/kal/bolt-abcdef/napok", True), status)
        self.shops[0]["allapot"] = "kuldheto"
        self.assertTrue(api.demo_access(uri, False))

    def test_only_a_released_slug_is_accessible(self):
        self.assertFalse(api.demo_access("/other-abcdef/", True))
        self.assertFalse(api.demo_access("/bolt-123456/", False))
        self.assertFalse(api.demo_access("/bolt-123456/", True))

    def test_missing_shop_or_bad_data_stays_closed_to_public(self):
        self.shops = []
        self.assertFalse(api.demo_access("/bolt-abcdef/", False))
        self.shops = [{"id": "bolt"}]
        self.assertFalse(api.demo_access("/bolt-abcdef/", False))
        self.releases.read_text.return_value = "not json"
        with self.assertRaises(ValueError):
            api.demo_access("/bolt-abcdef/", False)
        # A GET végpont a hibát 403-ra fordítja, nem 200-ra.

    def test_normalized_url_cannot_borrow_an_open_demo_access(self):
        for uri in ("/bolt-abcdef/../closed-123456/index.html",
                    "/bolt-abcdef/%2e%2e/closed-123456/index.html",
                    "/bolt-abcdef//closed-123456/index.html",
                    "/api/kal/bolt-abcdef/../closed-123456/napok"):
            self.assertFalse(api.demo_access(uri, False), uri)
            self.assertFalse(api.demo_access(uri, True), uri)

    def test_nginx_checks_demo_before_general_asset_cache(self):
        config = (ROOT / "nginx.conf").read_text()
        self.assertLess(config.index("auth_request /_demo_access"), config.index("location ~* /assets/"))
        self.assertIn("proxy_set_header X-Vezerlo-OK $vezerlo_ok;", config)
        self.assertIn("proxy_set_header X-Demo-URI $request_uri;", config)
        self.assertIn("error_page 403 =404 /404.html;", config)


if __name__ == "__main__":
    unittest.main()
