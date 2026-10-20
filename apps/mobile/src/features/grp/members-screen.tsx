/**
 * The admin's member list (GRP-01-AC28): each member's name and role, and
 * for every member but the admin, a removal that asks first, saying it takes
 * effect at once, and then shows the list without them.
 *
 * A removal answered MEMBER_NOT_FOUND is done all the same: the member is
 * gone, whatever removed them (F2). A 401 signs the phone out (AC29), and the
 * join screen takes over.
 */
import type { ListMembersResponse, Member, RemovedResponse } from '@trygghverdag/contracts';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { useGroupSession } from './session';
import { Button, Heading, Message, Screen } from './ui';

export function MembersScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { call } = useGroupSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const answer = await call<ListMembersResponse>({ method: 'GET', path: 'group/members' });
    if (answer.kind === 'unauthorized') {
      return;
    }
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
    const answer = await call<RemovedResponse>({
      method: 'DELETE',
      path: `group/members/${encodeURIComponent(member.userId)}`,
    });
    if (answer.kind === 'unauthorized') {
      return;
    }
    setBusy(false);
    setConfirming(null);
    if (answer.kind === 'ok' || (answer.kind === 'refused' && answer.status === 404)) {
      await load();
    } else {
      setFailed(true);
    }
  }

  return (
    <Screen>
      <Heading>{t('grp.members.title')}</Heading>
      {(members ?? []).map((member) => (
        <View key={member.userId} style={styles.row}>
          <Text style={styles.name}>{member.displayName}</Text>
          <Text style={styles.role}>
            {member.role === 'ADMIN' ? t('grp.members.admin') : t('grp.members.member')}
          </Text>
          {member.role === 'MEMBER' && confirming === null ? (
            <Button
              label={t('grp.members.remove', { name: member.displayName })}
              onPress={() => {
                setConfirming(member);
              }}
              quiet
            />
          ) : null}
        </View>
      ))}
      {confirming === null ? null : (
        <View style={styles.confirm}>
          <Message>{t('grp.members.confirmText', { name: confirming.displayName })}</Message>
          <Button
            label={t('grp.members.confirm')}
            onPress={() => void remove(confirming)}
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
        </View>
      )}
      {failed ? (
        <>
          <Message>{t('grp.member.unreachable')}</Message>
          <Button label={t('grp.member.retry')} onPress={() => void load()} quiet />
        </>
      ) : null}
      <Button label={t('grp.member.back')} onPress={onBack} quiet />
    </Screen>
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
  },
  role: {
    fontSize: 16,
  },
  confirm: {
    gap: 12,
  },
});
