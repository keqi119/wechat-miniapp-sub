import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('native_config', Path(__file__).with_name('prepare-native-config.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeConfigTest(unittest.TestCase):
    baseline = 'BUILD_VERSION="20261016-usage-v1"\nAPI_IMAGE="chundian-api:20261016-usage-v1"\nFADADA_ENABLED="false"\nFADADA_APP_SECRET="fixture-only-$literal"\nSMS_ENABLED="true"\n'

    def test_changes_only_selected_keys_and_keeps_channels_closed(self):
        result = module.prepare(self.baseline, '20261016-native-signing-v1')
        self.assertIn('FADADA_APP_SECRET="fixture-only-$literal"\n', result)
        self.assertIn('SMS_ENABLED="true"\n', result)
        values = {line.split('=', 1)[0]: json.loads(line.split('=', 1)[1]) for line in result.splitlines()}
        self.assertEqual(values['FADADA_BASE_URL'], 'https://textapi17.fadada.com/api2/')
        self.assertEqual(values['FADADA_SIGN_RETURN_URL'], 'https://mini-api.subauto.keybox.cloud/api/public/esign-return')
        for key in ('MINIAPP_SIGNING_ENABLED', 'H5_SIGNING_ENABLED', 'FADADA_ENABLED', 'FADADA_ACCOUNT_REGISTER_ENABLED', 'FADADA_REALNAME_VERIFY_ENABLED', 'FADADA_SIGNING_ENABLED'):
            self.assertEqual(values[key], 'false')

    def test_refuses_duplicate_keys(self):
        with self.assertRaises(ValueError): module.prepare(self.baseline + 'FADADA_ENABLED=false\n', '20261016-native-signing-v1')

    def test_refuses_unknown_baseline_and_active_channels(self):
        for before, after in [('20261016-usage-v1', 'unknown'), ('FADADA_ENABLED="false"', 'FADADA_ENABLED="true"')]:
            with self.assertRaises(ValueError): module.prepare(self.baseline.replace(before, after), '20261016-native-signing-v1')

    def test_refuses_invalid_release(self):
        with self.assertRaises(ValueError): module.prepare(self.baseline, '../../unknown')


if __name__ == '__main__': unittest.main()
