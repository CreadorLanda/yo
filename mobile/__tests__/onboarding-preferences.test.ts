import { expect, test } from 'bun:test';

test('the contact discovery switch saves its selected value', async () => {
  const source = await Bun.file('app/settings.tsx').text();

  expect(source).toContain('onValueChange={saveContactsVisibility}');
  expect(source).toContain('apiSaveOnboardingChoices({ contacts_visible: visible })');
  expect(source).toContain('disabled={!contactsPrefsLoaded}');
});
