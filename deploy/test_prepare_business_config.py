import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('business_config', Path(__file__).with_name('prepare-business-config.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BusinessConfigTest(unittest.TestCase):
    baseline = ('# retained comment\nBUILD_VERSION="20261016-native-signing-v1"\n'
                'API_IMAGE="chundian-api:20261016-native-signing-v1"\n'
                'MINIAPP_SIGNING_ENABLED=true\nH5_SIGNING_ENABLED=false\n'
                'FADADA_ENABLED=true\nFADADA_ACCOUNT_REGISTER_ENABLED=true\n'
                'FADADA_REALNAME_VERIFY_ENABLED=true\nFADADA_SIGNING_ENABLED=false\n'
                'FADADA_BASE_URL="https://textapi17.fadada.com/api2/"\n'
                'FADADA_APP_SECRET="fixture-only-$literal=retained"\n'
                'SMS_ENABLED=true\nWECHAT_PAY_ENABLED=false\n')

    def test_changes_only_build_and_image(self):
        result = module.prepare(self.baseline, '20261016-vehicle-change-v1')
        expected = self.baseline.replace('BUILD_VERSION="20261016-native-signing-v1"', 'BUILD_VERSION="20261016-vehicle-change-v1"').replace('API_IMAGE="chundian-api:20261016-native-signing-v1"', 'API_IMAGE="chundian-api:20261016-vehicle-change-v1"')
        self.assertEqual(result, expected)

    def test_rejects_duplicate_or_missing_required_keys(self):
        for source in [self.baseline + 'API_IMAGE=unexpected\n', self.baseline + ' FADADA_SIGNING_ENABLED = true\n', self.baseline.replace('FADADA_SIGNING_ENABLED=false\n', '')]:
            with self.assertRaises(ValueError): module.prepare(source, '20261016-vehicle-change-v1')

    def test_rejects_baseline_or_channel_drift(self):
        for before, after in [('20261016-native-signing-v1', 'unknown'), ('FADADA_SIGNING_ENABLED=false', 'FADADA_SIGNING_ENABLED=true'), ('MINIAPP_SIGNING_ENABLED=true', 'MINIAPP_SIGNING_ENABLED=false'), ('textapi17.fadada.com', 'textapi.fadada.com')]:
            with self.assertRaises(ValueError): module.prepare(self.baseline.replace(before, after), '20261016-vehicle-change-v1')

    def test_rejects_dotenv_export_overrides(self):
        for override in ['export FADADA_SIGNING_ENABLED=true\n', '  export   MINIAPP_SIGNING_ENABLED = false\n', 'export BUILD_VERSION=unexpected\n']:
            with self.assertRaises(ValueError): module.prepare(self.baseline + override, '20261016-vehicle-change-v1')

    def test_rejects_dotenv_colon_overrides(self):
        for override in ['FADADA_SIGNING_ENABLED: true\n', '  export MINIAPP_SIGNING_ENABLED: false\n', 'BUILD_VERSION: unexpected\n']:
            with self.assertRaises(ValueError): module.prepare(self.baseline + override, '20261016-vehicle-change-v1')

    def test_rejects_unexpected_release(self):
        for release in ['../../other', '20261016-vehicle-change-v0', '20261016-native-signing-v2']:
            with self.assertRaises(ValueError): module.prepare(self.baseline, release)


if __name__ == '__main__': unittest.main()
