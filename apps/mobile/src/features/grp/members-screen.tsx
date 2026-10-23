/**
 * The admin's member list (GRP-01-AC28): each member's name and role, and
 * for every member but the admin, a removal that asks first, saying it takes
 * effect at once, and then shows the list without them.
 *
 * Review loop 1 (a11y-i18n-reviewer, code-reviewer S4):
 *   - the confirmation shows in that member's own row, where the admin
 *     pressed, not after the list, where a long list put it out of sight;
 *     its button names the member;
 *   - a removal answered 403 or 409 is said as a refusal, in that member's
 *     row, never as a server that could not be reached;
 *   - a removal done is said, naming them, once the list shows without them;
 *   - while the list loads, a waiting indicator shows at the top (AC30);
 *     while a removal is in flight, inside the confirmation, beside its
 *     buttons, which stay on screen, disabled (review loop 2).
 *
 * What a removal's answer comes to:
 *   - 200, or 404 with the code MEMBER_NOT_FOUND: done. The member is gone,
 *     whatever removed them (F2);
 *   - any other refusal, a 4xx but 401 (a 403, a 409, a 404 without that
 *     code, a 400): refused, said in that member's row, and they stay
 *     listed (review loop 2);
 *   - no answer, or a 5xx: the server could not be reached, with a retry;
 *   - a 401: the phone is signed out (AC29), and the join screen takes over.
 */
import type {
  ListMembersResponse,
  Member,
  RemovedResponse,
  removeMemberErrors,
} from '@trygghverdag/contracts';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Heading, Message, Waiting, palette } from '../../shared/ui';
import { useGroupSession } from './session';

/** The refusal that means the member is gone already: a removal done (F2). */
const GONE_ALREADY: keyof typeof removeMemberErrors = 'MEMBER_NOT_FOUND';

/** What the last removal came to, said where it belongs. */
type Outcome = { kind: 'removed'; name: string } | { kind: 'refused'; userId: string } | null;

export function MembersScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { call } = useGroupSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const load = useCallback(async () => {
    setFailed(false);
    setLoading(true);
    const answer = await call<ListMembersResponse>({ method: 'GET', path: 'group/members' });
    if (answer.kind === 'unauthorized') {
      return;
    }
    setLoading(false);
    if (answer.kind === 'ok') {
      setMembers(answer.body.members);
    } else {
      setFailed(true);
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(member: Member) {
    setBusy(true);
    setOutcome(null);
    const answer = await call<RemovedResponse>({
      method: 'DELETE',
      path: `group/members/${encodeURIComponent(member.userId)}`,
    });
    if (answer.kind === 'unauthorized') {
      return;
    }
    setBusy(false);
    setConfirming(null);
    if (
      answer.kind === 'ok' ||
      (answer.kind === 'refused' && answer.status === 404 && answer.code === GONE_ALREADY)
    ) {
      // Gone, as the server says: off the list at once, then the list again.
      setMembers((shown) => shown?.filter(({ userId }) => userId !== member.userId) ?? null);
      setOutcome({ kind: 'removed', name: member.displayName });
      await load();
    } else if (answer.kind === 'refused') {
      setOutcome({ kind: 'refused', userId: member.userId });
    } else {
      setFailed(true);
    }
  }

  return (
    <>
      <Heading>{t('grp.members.title')}</Heading>
      {loading ? <Waiting label={t('grp.waiting')} /> : null}
      {outcome?.kind === 'removed' ? (
        <Message>{t('grp.members.removed', { name: outcome.name })}</Message>
      ) : null}
      {(members ?? []).map((member) => (
        <View key={member.userId} style={styles.row}>
          <Text style={styles.name}>{member.displayName}</Text>
          <Text style={styles.role}>
            {member.role === 'ADMIN' ? t('grp.members.admin') : t('grp.members.member')}
          </Text>
          {outcome?.kind === 'refused' && outcome.userId === member.userId ? (
            <Message>{t('grp.members.refused')}</Message>
          ) : null}
          {confirming?.userId === member.userId ? (
            <View style={styles.confirm}>
              <Message>{t('grp.members.confirmText', { name: member.displayName })}</Message>
              <Button
                label={t('grp.members.confirm', { name: member.displayName })}
                onPress={() => void remove(member)}
                disabled={busy}
              />
              <Button
                label={t('grp.members.cancel')}
                onPress={() => {
                  setConfirming(null);
                }}
                disabled={busy}
                quiet
              />
              {busy ? <Waiting label={t('grp.waiting')} /> : null}
            </View>
          ) : null}
          {member.role === 'MEMBER' && confirming === null ? (
            <Button
              label={t('grp.members.remove', { name: member.displayName })}
              onPress={() => {
                setOutcome(null);
                setConfirming(member);
              }}
              quiet
            />
          ) : null}
        </View>
      ))}
      {failed ? (
        <>
          <Message>{t('grp.member.unreachable')}</Message>
          <Button label={t('grp.member.retry')} onPress={() => void load()} quiet />
        </>
      ) : null}
      <Button label={t('grp.member.back')} onPress={onBack} quiet />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 8,
  },
  name: {
    fontSize: 20,
    fontWeight: '600',
    color: palette.text,
  },
  role: {
    fontSize: 16,
    color: palette.text,
  },
  confirm: {
    gap: 12,
  },
});
