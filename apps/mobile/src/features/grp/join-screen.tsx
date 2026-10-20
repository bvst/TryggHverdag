/**
 * The join screen (GRP-01-AC26, AC27, AC29): the invitation code and the
 * person's own name, and nothing that looks joined until the server says so.
 *
 * What it says, plainly:
 *   - a 404 or a 400: the one message, ask the admin for a new invitation;
 *   - no answer, or a 5xx: nothing was saved, and a retry that sends the
 *     same join again, its join key with it (AC5);
 *   - signed out by a 401: that this phone is no longer signed in.
 * The member screen shows only once the join is answered 201 and its
 * credential is in secure storage.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroupSession, type JoinBody } from './session';
import { Body, Button, Heading, Message, Screen, TextField } from './ui';

/** The longest code a person may type, separators included. */
const CODE_MAX_LENGTH = 64;
/** The longest name a membership holds (approach item 2). */
const NAME_MAX_LENGTH = 40;

export function JoinScreen({ signedOut }: { signedOut: boolean }) {
  const { t } = useTranslation();
  const { joinBody, join } = useGroupSession();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'notValid' | 'notSaved' | null>(null);
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
        maxLength={NAME_MAX_LENGTH}
      />
      <Button label={t('grp.join.submit')} onPress={() => void submit()} disabled={!ready} />
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
