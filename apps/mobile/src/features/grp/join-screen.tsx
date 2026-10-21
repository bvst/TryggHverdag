/**
 * The join screen (GRP-01-AC26, AC27, AC29): the invitation code and the
 * person's own name, and nothing that looks joined until the server says so.
 *
 * What it says, plainly:
 *   - a name the contract's rule refuses (GRP-01-AC31): that the name cannot
 *     be used, and nothing is sent, so it is never shown as a refused
 *     invitation;
 *   - a 404 or a 400: the one message, ask the admin for a new invitation;
 *   - no answer, or a 5xx: nothing was saved, and a retry that sends the
 *     same join again, its join key with it (AC5);
 *   - signed out by a 401: that this phone is no longer signed in.
 * The member screen shows only once the join is answered 201 and its
 * credential is in secure storage. While a join is in flight, a waiting
 * indicator shows (AC30).
 */
import { MAX_DISPLAY_NAME_LENGTH, isUsableDisplayName } from '@trygghverdag/contracts/display-name';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroupSession, type JoinBody } from './session';
import { Body, Button, Heading, Message, Screen, TextField, Waiting } from './ui';

/** The longest code a person may type, separators included. */
const CODE_MAX_LENGTH = 64;

export function JoinScreen({ signedOut }: { signedOut: boolean }) {
  const { t } = useTranslation();
  const { joinBody, join } = useGroupSession();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'notValid' | 'notSaved' | 'nameNotUsable' | null>(null);
  /** The join that saved nothing, kept to be sent again exactly as it was. */
  const [unsent, setUnsent] = useState<JoinBody | null>(null);

  async function send(body: JoinBody) {
    setBusy(true);
    setMessage(null);
    const outcome = await join(body);
    if (outcome === 'joined') {
      // The member screen takes over from here.
      return;
    }
    setBusy(false);
    setMessage(outcome);
    setUnsent(outcome === 'notSaved' ? body : null);
  }

  async function submit() {
    // The contract's own rule, before anything is sent (AC31).
    if (!isUsableDisplayName(name)) {
      setMessage('nameNotUsable');
      setUnsent(null);
      return;
    }
    let body: JoinBody;
    try {
      body = await joinBody({ invitationCode: code, displayName: name });
    } catch {
      setMessage('notSaved');
      return;
    }
    await send(body);
  }

  const ready = !busy && code.trim() !== '' && name.trim() !== '';

  return (
    <Screen>
      <Heading>{t('grp.join.title')}</Heading>
      <Body>{t('grp.join.intro')}</Body>
      {signedOut ? <Message>{t('grp.join.signedOut')}</Message> : null}
      <TextField
        label={t('grp.join.codeLabel')}
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={CODE_MAX_LENGTH}
      />
      <TextField
        label={t('grp.join.nameLabel')}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={MAX_DISPLAY_NAME_LENGTH}
      />
      <Button label={t('grp.join.submit')} onPress={() => void submit()} disabled={!ready} />
      {busy ? <Waiting label={t('grp.waiting')} /> : null}
      {message === null ? null : <Message>{t(`grp.join.${message}`)}</Message>}
      {message === 'notSaved' && unsent !== null ? (
        <Button
          label={t('grp.join.retry')}
          onPress={() => void send(unsent)}
          disabled={busy}
          quiet
        />
      ) : null}
    </Screen>
  );
}
