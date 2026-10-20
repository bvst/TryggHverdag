/**
 * The admin's invitation (GRP-01-AC28): create one, then its code, when it
 * expires, and the system's own share sheet to send it any way the admin
 * likes (D-136, answer 3). React Native's `Share`, no web link and no deep
 * link (D-013).
 *
 * The code is shown as the API gives it, in four groups of five, and is kept
 * nowhere: the server keeps only its hash, and leaving this screen loses it.
 * A 401 signs the phone out (AC29), and the join screen takes over.
 */
import type { CreateInvitationResponse } from '@trygghverdag/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, Text } from 'react-native';

import { useGroupSession } from './session';
import { Button, Heading, Message, Screen } from './ui';

/** When the invitation expires, as a person reads a date and a time in their own language. */
function expiryOf(expiresAt: string, language: string): string {
  const moment = new Date(expiresAt);
  try {
    return new Intl.DateTimeFormat(language, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(moment);
  } catch {
    return moment.toLocaleString();
  }
}

export function InviteScreen({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const { call } = useGroupSession();
  const [invitation, setInvitation] = useState<CreateInvitationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function create() {
    setBusy(true);
    setFailed(false);
    const answer = await call<CreateInvitationResponse>({
      method: 'POST',
      path: 'group/invitations',
      body: {},
    });
    if (answer.kind === 'unauthorized') {
      // Signed out: the join screen takes over.
      return;
    }
    setBusy(false);
    if (answer.kind === 'ok') {
      setInvitation(answer.body);
    } else {
      setFailed(true);
    }
  }

  return (
    <Screen>
      <Heading>{t('grp.invite.title')}</Heading>
      {invitation === null ? null : (
        <>
          <Text selectable style={styles.code}>
            {invitation.invitationCode}
          </Text>
          <Text style={styles.expiry}>
            {t('grp.invite.expires', { date: expiryOf(invitation.expiresAt, i18n.language) })}
          </Text>
          <Button
            label={t('grp.invite.share')}
            onPress={() => {
              void Share.share({ message: invitation.invitationCode });
            }}
          />
        </>
      )}
      <Button
        label={t('grp.invite.create')}
        onPress={() => void create()}
        disabled={busy}
        quiet={invitation !== null}
      />
      {failed ? <Message>{t('grp.member.unreachable')}</Message> : null}
      <Button label={t('grp.member.back')} onPress={onBack} quiet />
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
  },
  expiry: {
    fontSize: 17,
    textAlign: 'center',
  },
});
