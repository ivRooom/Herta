"""Offline Compose contract checks. Uses only synthetic credentials; never starts services."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BASE = '1941b7e7862eb405ed44e0cc627b010a4eb1e48b'
with tempfile.TemporaryDirectory(prefix='herta-compose-') as temp:
    fixture = Path(temp)
    original = subprocess.check_output(['git', 'show', f'{BASE}:docker-compose.prod.yml'], cwd=ROOT)
    (fixture / 'baseline.yml').write_bytes(original)
    values = {}
    for line in (ROOT / '.env.production.example').read_text(encoding='utf-8').splitlines():
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key] = value or 'fixture'
    values.pop('HERTA_DATABASE_MODE', None)
    values.update(TEAM_SPLIT_RECOMMENDATION_SECRET='fixture', DISCORD_CLIENT_ID='fixture', DISCORD_CLIENT_SECRET='fixture', DISCORD_BOT_TOKEN='fixture')
    envfile = fixture / 'env'
    def render(file, changes=None):
        entries = {**values, **(changes or {})}
        envfile.write_text('\n'.join(f'{k}={v}' for k, v in entries.items()), encoding='utf-8')
        env = {k: v for k, v in os.environ.items() if k not in entries and k != 'HERTA_DATABASE_MODE'}
        result = subprocess.run(['docker', 'compose', '--project-directory', str(ROOT), '--project-name', 'herta', '--env-file', str(envfile), '-f', str(file), 'config', '--format', 'json'], env=env, capture_output=True, text=True)
        if result.returncode:
            raise AssertionError('Synthetic Compose render failed: ' + result.stderr)
        return json.loads(result.stdout)
    baseline = render(fixture / 'baseline.yml')
    local = render(ROOT / 'docker-compose.prod.yml')
    migrator = local['services']['migrator']
    assert '$HERTA_DATABASE_MODE' in migrator.pop('entrypoint')[2]
    assert migrator['environment'].pop('HERTA_DATABASE_MODE') == 'local'
    baseline['services']['migrator'].pop('entrypoint', None)
    baseline = {k: v for k, v in baseline.items() if not k.startswith('x-')}
    local = {k: v for k, v in local.items() if not k.startswith('x-')}
    # New feature settings do not alter the database topology. Verify their
    # explicit default before excluding just these additions from old baseline.
    for name in ['studio', 'bot', 'worker']:
        assert local['services'][name]['environment'].pop('DAILY_BONUS_ENABLED') == 'false'
    assert local['services']['bot']['environment'].pop('DAILY_BONUS_RESULT_CARD_ENABLED') == 'false'
    assert local['services']['bot']['environment'].pop('HERTA_POINTS_SECRET') == values.get('HERTA_POINTS_SECRET', '')
    # Voice provider configuration is not a database topology change.
    # It must remain fail-closed in every default/local deployment.
    assert local['services']['bot']['environment'].pop('VC_RECAP_TRANSCRIPTION_PROVIDER') == 'aws'
    assert local['services']['bot']['environment'].pop('VC_RECAP_OPENAI_AUDIO_CONSENT_READY') == 'false'
    assert local['services']['bot']['environment'].pop('VC_RECAP_OPENAI_SESSION_MAX_AUDIO_MINUTES') == '120'
    assert local == baseline, 'Default-local topology changed beyond the mode guard'
    enabled = render(ROOT / 'docker-compose.prod.yml', {'DAILY_BONUS_ENABLED': 'true', 'HERTA_POINTS_SECRET': 'fixture-points'})
    assert enabled['services']['bot']['environment']['HERTA_POINTS_SECRET'] == 'fixture-points'
    assert 'HERTA_POINTS_SECRET' not in enabled['services']['studio']['environment']
    assert 'HERTA_POINTS_SECRET' not in enabled['services']['worker']['environment']
    external = render(ROOT / 'docker-compose.external.yml', {
        'HERTA_DATABASE_MODE': 'external', 'HERTA_DATABASE_PRIVATE_IP': '10.0.0.2',
        'HERTA_DATABASE_CA_FILE': str(fixture / 'ca.crt'), 'MIGRATION_DATABASE_URL': 'postgresql://migrator-fixture',
        'POSTGRES_DB': '', 'POSTGRES_USER': '', 'POSTGRES_PASSWORD': '',
    })
    assert 'postgres' not in external['services'] and 'postgres_data' not in external['volumes']
    for name, service in external['services'].items():
        assert 'postgres' not in service.get('depends_on', {})
        if name in ['api', 'studio', 'bot', 'worker', 'migrator']:
            hosts = service['extra_hosts']
            assert (hosts.get('ivrm-db-postgres.internal') == '10.0.0.2' if isinstance(hosts, dict) else 'ivrm-db-postgres.internal=10.0.0.2' in hosts)
            assert any(v['target'] == '/run/ivrm/postgresql-ca.crt' and v['read_only'] for v in service['volumes'])
        if name in ['api', 'studio', 'bot', 'worker']:
            assert 'MIGRATION_DATABASE_URL' not in service['environment']
            assert service['environment']['DATABASE_URL'] == values['DATABASE_URL']
    assert external['services']['migrator']['environment']['DATABASE_URL'] == 'postgresql://migrator-fixture'
    command = external['services']['migrator']['command'][2]
    assert 'migrate status' in command and 'migrate deploy' not in command and 'timeout 30' in command
    assert external['services']['bot']['depends_on']['migrator']['condition'] == 'service_completed_successfully'
print('Compose local baseline and external isolation checks passed')
