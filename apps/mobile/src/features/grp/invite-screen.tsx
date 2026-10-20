/**
 * The admin's invitation (GRP-01-AC28): create one, then its code, when it
 * expires, and the system's own share sheet to send it any way the admin
 * likes (D-136, answer 3). React Native's `Share`, no web link and no deep
 * link (D-013).
 *
 * The code is shown in its four groups of five, and is kept nowhere: the
 * server keeps only its hash, and leaving this screen loses it. A 401 signs
 * the phone out (AC29), and the join screen takes over.
 *
 * How the code is shown and read (GRP-01-AC28, review loop 1):
 *   - each group of five is a Text of its own, inside no other Text, and the
 *     groups wrap as whole boxes: five letters and digits have no line-break
 *     opportunity, so no group breaks when the line wraps (a hyphen before a
 *     digit is none either, so one Text with hyphens could);
 *   - the four are one element to a screen reader, whose label spells the
 *     code character by character, group by group ("K 7 Q 2 M, 9 T R V X,
 *     …"), not as a word;
 *   - it is announced, spelled so, when it appears;
 *   - (review loop 2) the label and the announcement begin with the code
 *     field's own name and a colon ("Invitasjonskode: K 7 Q 2 M, …"), so
 *     the characters are never read without saying what they are, and
 *     nothing follows the code.
 */
import type { CreateInvitationResponse } from '@trygghverdag/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Share, StyleSheet, Text, View } from 'react-native';

import { useGroupSession } from './session';
import { Button, Heading, Message, Screen, Waiting } from './ui';

/** The code's groups of five, whatever separates them as the API gives it. */
function groupsOf(code: string): string[] {
  return code.replace(/[^0-9A-Za-z]/g, '').match(/.{1,5}/g) ?? [];
}

/** The code as a screen reader should read it: each character apart, a pause between groups. */
function spelled(groups: string[]): string {
  return groups.map((group) => Array.from(group).join(' ')).join(', ');
}

/** What the code is called, then the code, spelled: its label and its announcement alike. */
function named(name: string, groups: string[]): string {
  return `${name}: ${spelled(groups)}`;
}

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
      AccessibilityInfo.announceForAccessibility(
        named(t('grp.join.codeLabel'), groupsOf(answer.body.invitationCode)),
      );
    } else {
      setFailed(true);
    }
  }

  const groups = invitation === null ? [] : groupsOf(invitation.invitationCode);

  return (
    <Screen>
      <Heading>{t('grp.invite.title')}</Heading>
      {invitation === null ? null : (
        <>
          <View
            accessible
            accessibilityLabel={named(t('grp.join.codeLabel'), groups)}
            style={styles.codeGroups}
          >
            {groups.map((group, at) => (
              // A group's place tells it apart: two groups may read the same.
              <Text key={at} style={styles.code}>
                {group}
              </Text>
            ))}
          </View>
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
      {busy ? <Waiting label={t('grp.waiting')} /> : null}
      {failed ? <Message>{t('grp.member.unreachable')}</Message> : null}
      <Button label={t('grp.member.back')} onPress={onBack} quiet />
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeGroups: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 16,
    rowGap: 4,
  },
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
