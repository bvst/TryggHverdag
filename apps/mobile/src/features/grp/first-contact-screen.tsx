/**
 * The setup screen for the walker's #1 contact (GRP-02, approach item 5):
 * a name and a phone number, typed (Q2, D-141), each field with its label
 * shown above it, the number's opening the phone keypad.
 *
 *   - Opened to change #1, the fields hold the current one.
 *   - "Lagre" checks the name with the contract's display-name rule and the
 *     number with GRP-02's number rule (first-contact.ts), says which one is
 *     refused, and saves nothing then (GRP-02-AC3, AC4). A save secure storage
 *     refuses is said, and the earlier #1, or none, stays (GRP-02-AC8).
 *   - "Avbryt", or Android's back, returns to the home screen with nothing
 *     changed (GRP-02-AC5).
 *   - Choosing the first #1, without Android's call permission, one line
 *     says why it is wanted; once #1 is saved, and only then, Android's own
 *     dialog asks for it, once (CALL-01, approach 3; CALL-01-AC3). Whatever
 *     it answers, the save is done.
 * Nothing typed here is sent to the server (GRP-02-AC6), or logged (PRIV-07).
 */
import { MAX_DISPLAY_NAME_LENGTH } from '@trygghverdag/contracts/display-name';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Body, Button, Heading, Message, TextField, Waiting } from '../../shared/ui';
import type { CallPermissionState } from '../call';
import { firstContactOf, type FirstContact } from './first-contact';
import { useGroupSession } from './session';

/** The longest number a person may type, separators included. */
const NUMBER_MAX_LENGTH = 32;

export function FirstContactScreen({
  current,
  permission,
  onDone,
}: {
  /** The #1 being changed, or null when the walker chooses one. */
  current: FirstContact | null;
  permission: CallPermissionState;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { saveFirstContact } = useGroupSession();
  const [name, setName] = useState(current?.name ?? '');
  const [number, setNumber] = useState(current?.number ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'nameNotUsable' | 'numberNotUsable' | 'notSaved' | null>(
    null,
  );
  /** The first #1, with the call permission not held: the walker is told why, and asked after the save. */
  const askAfterSaving = current === null && permission.permission === 'notGranted';

  async function save() {
    const contact = firstContactOf({ name, number });
    if (typeof contact === 'string') {
      setMessage(contact);
      return;
    }
    setBusy(true);
    setMessage(null);
    if (!(await saveFirstContact(contact))) {
      setBusy(false);
      setMessage('notSaved');
      return;
    }
    if (askAfterSaving) {
      await permission.ask();
    }
    onDone();
  }

  return (
    <>
      <Heading>{t('grp.firstContact.title')}</Heading>
      <Body>{t('grp.firstContact.intro')}</Body>
      {askAfterSaving ? <Body>{t('call.permission.why')}</Body> : null}
      <TextField
        label={t('grp.firstContact.nameLabel')}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="off"
        maxLength={MAX_DISPLAY_NAME_LENGTH}
      />
      <TextField
        label={t('grp.firstContact.numberLabel')}
        value={number}
        onChangeText={setNumber}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={NUMBER_MAX_LENGTH}
      />
      <Button label={t('grp.firstContact.save')} onPress={() => void save()} disabled={busy} />
      {busy ? <Waiting label={t('grp.waiting')} /> : null}
      {message === null ? null : <Message>{t(`grp.firstContact.${message}`)}</Message>}
      <Button label={t('grp.firstContact.cancel')} onPress={onDone} disabled={busy} quiet />
    </>
  );
}
