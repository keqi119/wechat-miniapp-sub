import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('technical_config', Path(__file__).with_name('prepare-technical-config.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TechnicalConfigTest(unittest.TestCase):
    release = '20261016-technical-signing-v1'
    baseline = ('# retained\nBUILD_VERSION="20261016-vehicle-change-v1"\n'
                'API_IMAGE="chundian-api:20261016-vehicle-change-v1"\n'
                'MINIAPP_SIGNING_ENABLED=true\nH5_SIGNING_ENABLED=false\n'
                'FADADA_ENABLED=true\nFADADA_ACCOUNT_REGISTER_ENABLED=true\n'
                'FADADA_REALNAME_VERIFY_ENABLED=true\nFADADA_SIGNING_ENABLED=false\n'
                'FADADA_BASE_URL="https://textapi17.fadada.com/api2/"\n'
                'FADADA_APP_SECRET="fixture-only-$literal=retained"\n'
                'SMS_ENABLED=true\nWECHAT_PAY_ENABLED=false\n')

    def test_prepare_only_advances_build_and_adds_disabled_flag(self):
        actual = module.transition(self.baseline, self.release, 'prepare')
        expected = self.baseline.replace('20261016-vehicle-change-v1', self.release) + 'TECHNICAL_ACCEPTANCE_SIGNING_ENABLED=false\n'
        self.assertEqual(actual, expected)

    def test_enable_disable_changes_only_technical_flag(self):
        prepared = self.baseline.replace('20261016-vehicle-change-v1', self.release) + 'TECHNICAL_ACCEPTANCE_SIGNING_ENABLED=false\n'
        enabled = module.transition(prepared, self.release, 'enable')
        self.assertEqual(enabled, prepared.replace('TECHNICAL_ACCEPTANCE_SIGNING_ENABLED=false', 'TECHNICAL_ACCEPTANCE_SIGNING_ENABLED=true'))
        self.assertEqual(module.transition(enabled, self.release, 'disable'), prepared)

    def test_rejects_commercial_and_channel_drift(self):
        for before, after in [('FADADA_SIGNING_ENABLED=false', 'FADADA_SIGNING_ENABLED=true'), ('WECHAT_PAY_ENABLED=false', 'WECHAT_PAY_ENABLED=true'), ('H5_SIGNING_ENABLED=false', 'H5_SIGNING_ENABLED=true'), ('textapi17.fadada.com', 'textapi.fadada.com'), ('BUILD_VERSION="20261016-vehicle-change-v1"', 'BUILD_VERSION="unexpected"')]:
            with self.assertRaises(ValueError): module.transition(self.baseline.replace(before, after), self.release, 'prepare')
        for extra in ['SWAP_CREDIT_PURCHASE_ENABLED=true\n', 'TECHNICAL_ACCEPTANCE_SIGNING_ENABLED=true\n']:
            with self.assertRaises(ValueError): module.transition(self.baseline + extra, self.release, 'prepare')

    def test_rejects_duplicate_missing_and_alternate_assignment(self):
        for source in [self.baseline + 'export FADADA_SIGNING_ENABLED=true\n', self.baseline + '  FADADA_SIGNING_ENABLED: true\n', self.baseline.replace('WECHAT_PAY_ENABLED=false\n', ''), self.baseline + 'TECHNICAL_ACCEPTANCE_SIGNING_ENABLED=false\nTECHNICAL_ACCEPTANCE_SIGNING_ENABLED=false\n']:
            with self.assertRaises(ValueError): module.transition(source, self.release, 'prepare')

    def test_enable_requires_deployed_version_and_explicit_flag(self):
        for source in [self.baseline, self.baseline.replace('20261016-vehicle-change-v1', self.release)]:
            with self.assertRaises(ValueError): module.transition(source, self.release, 'enable')

    def test_crlf_preserved_and_existing_false_flag_not_duplicated(self):
        source = (self.baseline + 'TECHNICAL_ACCEPTANCE_SIGNING_ENABLED=false\n').replace('\n', '\r\n')
        actual = module.transition(source, self.release, 'prepare')
        self.assertEqual(actual, source.replace('20261016-vehicle-change-v1', self.release))

    def test_rejects_invalid_phase_and_release(self):
        for release, phase in [('../../other', 'prepare'), ('20261016-technical-signing-v0', 'prepare'), (self.release, 'anything')]:
            with self.assertRaises(ValueError): module.transition(self.baseline, release, phase)

    def test_rejects_mismatched_or_repeated_quotes(self):
        for value in ['"false\'', '\'false"', '""false""']:
            with self.assertRaises(ValueError): module.transition(self.baseline.replace('WECHAT_PAY_ENABLED=false', 'WECHAT_PAY_ENABLED=' + value), self.release, 'prepare')


if __name__ == '__main__': unittest.main()
