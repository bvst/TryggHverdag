/**
 * What the app opens on (GRP-01, approach item 14): the join screen for a
 * phone that is not signed in, the member screen for one that is, and, when
 * the server could not be reached to ask, that said plainly with a retry,
 * the credential kept (AC29). Nothing but a waiting indicator shows until
 * secure storage has been read and, for a phone that holds a credential,
 * the server has said who it is (AC30), so a signed-in phone never flashes
 * the join screen.
 *
 * The admin's invitation and member list open from the member screen, in
 * this one route, so whatever signs the phone out, from any of them, brings
 * the join screen back at once. Back, on screen or Android's own, returns to
 * the member screen.
 */
import type { Member } from '@trygghverdag/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler } from 'react-native';

import { InviteScreen } from './invite-screen';
import { JoinScreen } from './join-screen';
import { MembersScreen } from './members-screen';
import { useGroupSession } from './session';
import { Body, Button, Heading, Message, Screen, Waiting } from './ui';

/** Which of the member's screens is open. */
type View = 'member' | 'invite' | 'members';

/**
 * The member screen: the phone is signed in to the group, and nothing that
 * suggests anyone is being looked after, since no journey exists in the app
 * yet. The admin has their two choices here; a member has neither (AC28).
 */
function MemberScreen({ member, open }: { member: Member; open: (view: View) => void }) {
  const { t } = useTranslation();

  return (
    <Screen>
      <Heading>{t('grp.member.title')}</Heading>
      <Body>{t('grp.member.status')}</Body>
      {member.role === 'ADMIN' ? (
        <>
          <Button
            label={t('grp.member.invite')}
            onPress={() => {
              open('invite');
            }}
          />
          <Button
            label={t('grp.member.members')}
            onPress={() => {
              open('members');
            }}
          />
        </>
      ) : null}
    </Screen>
  );
}

/** The member's screens, and the admin's two beside them. */
function MemberArea({ member }: { member: Member }) {
  const [view, setView] = useState<View>('member');

  useEffect(() => {
    if (view === 'member') {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setView('member');
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [view]);

  const back = () => {
    setView('member');
  };
  switch (view) {
    case 'member':
      return <MemberScreen member={member} open={setView} />;
    case 'invite':
      return <InviteScreen onBack={back} />;
    case 'members':
      return <MembersScreen onBack={back} />;
  }
}

/** The server could not be reached to ask who this phone is: said, with a retry, and nothing signed out. */
function UnreachableScreen() {
  const { t } = useTranslation();
  const { retry } = useGroupSession();
  const [busy, setBusy] = useState(false);

  return (
    <Screen>
      <Message>{t('grp.member.unreachable')}</Message>
      <Button
        label={t('grp.member.retry')}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void retry();
        }}
      />
    </Screen>
  );
}

/** While the app starts, and asks the server who this phone is. */
function StartingScreen() {
  const { t } = useTranslation();

  return (
    <Screen>
      <Waiting label={t('grp.waiting')} />
    </Screen>
  );
}

export function HomeScreen() {
  const { state } = useGroupSession();

  switch (state.phase) {
    case 'starting':
      return <StartingScreen />;
    case 'joining':
      return <JoinScreen signedOut={state.signedOut} />;
    case 'unreachable':
      return <UnreachableScreen />;
    case 'member':
      return <MemberArea member={state.member} />;
  }
}
