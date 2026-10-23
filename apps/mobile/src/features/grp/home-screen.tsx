/**
 * What the app opens on (GRP-01, approach item 14; GRP-02; CALL-02, approach
 * 2), drawn inside the index route's `Screen`, below the 112 bar:
 *   - while secure storage is read, a waiting indicator, and nothing else;
 *   - with no credential, the join screen;
 *   - with one, the home screen at once, without waiting for the server
 *     (CALL-02-AC8, GRP-02-AC7): who #1 is, the call button, and "Bytt
 *     nummer 1-kontakt"; then what the server has said. Nothing of the group
 *     shows until it has answered with the member: the heading and the status
 *     line, and the admin's two choices. While it is asked, a waiting
 *     indicator; when it could not be reached, that is said, with a retry,
 *     and the credential and #1 are kept (GRP-01-AC29).
 *
 * The call button is the same button, in the same place, with #1 or without
 * (GRP-02-AC1): without, it says what is missing and opens the setup screen,
 * and it is never a dead button and never calls anyone. Nothing here says or
 * implies that anyone is looked after, alerted, following, or can see where
 * the walker is (CALL-01-AC7): no journey exists in the app yet, and calling
 * #1 shares nothing.
 *
 * The setup screen, and the admin's invitation and member list, open from the
 * home screen, in this one route, so whatever signs the phone out, from any of
 * them, brings the join screen back at once. Back, on screen or Android's
 * own, returns to the home screen.
 */
import type { Member } from '@trygghverdag/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, StyleSheet, Text } from 'react-native';

import { Body, Button, Heading, Message, Waiting, palette } from '../../shared/ui';
import {
  CallButton,
  CallPermissionLine,
  spelledNumber,
  useCallPermission,
  type CallPermissionState,
} from '../call';
import { FirstContactScreen } from './first-contact-screen';
import type { FirstContactState } from './first-contact';
import { InviteScreen } from './invite-screen';
import { JoinScreen } from './join-screen';
import { MembersScreen } from './members-screen';
import { useGroupSession, type ServerAnswer } from './session';

/** Which of the home screen's views is open. */
type View = 'home' | 'setup' | 'invite' | 'members';

/** What the server has said, on the home screen: the group's part, below the call button. */
function GroupPart({ server, open }: { server: ServerAnswer; open: (view: View) => void }) {
  const { t } = useTranslation();
  const { retry } = useGroupSession();
  const [busy, setBusy] = useState(false);

  switch (server.kind) {
    case 'asking':
      return <Waiting label={t('grp.waiting')} />;
    case 'unreachable':
      return (
        <>
          <Message>{t('grp.member.unreachable')}</Message>
          <Button
            label={t('grp.member.retry')}
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void retry().finally(() => {
                setBusy(false);
              });
            }}
          />
        </>
      );
    case 'member':
      return <MemberPart member={server.member} open={open} />;
  }
}

/** The phone is signed in to the group: said, and the admin's two choices (GRP-01-AC28). */
function MemberPart({ member, open }: { member: Member; open: (view: View) => void }) {
  const { t } = useTranslation();

  return (
    <>
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
    </>
  );
}

/** The home screen's own view: #1, the call button, and the group's part. */
function HomeView({
  server,
  firstContact,
  permission,
  open,
}: {
  server: ServerAnswer;
  firstContact: FirstContactState;
  permission: CallPermissionState;
  open: (view: View) => void;
}) {
  const { t } = useTranslation();
  const choose = () => {
    open('setup');
  };

  return (
    <>
      {firstContact.kind === 'set' ? (
        <>
          <Text style={styles.firstContact}>
            {t('grp.firstContact.shown', { name: firstContact.contact.name })}
          </Text>
          {/* Exactly what the button dials, read digit by digit (GRP-02-AC10). */}
          <Text
            accessibilityLabel={spelledNumber(firstContact.contact.number)}
            style={styles.number}
          >
            {firstContact.contact.number}
          </Text>
          <CallButton callee={firstContact.contact} />
          <CallPermissionLine permission={permission} />
          <Button label={t('grp.firstContact.change')} onPress={choose} quiet />
        </>
      ) : (
        <CallButton
          callee={null}
          title={t('grp.firstContact.none')}
          line={t(
            firstContact.kind === 'none'
              ? 'grp.firstContact.noneHint'
              : 'grp.firstContact.unreadable',
          )}
          onPress={choose}
        />
      )}
      <GroupPart server={server} open={open} />
    </>
  );
}

/** The home screen and the views that open from it, with Android's call permission read once for all of them. */
function HomeArea({
  server,
  firstContact,
}: {
  server: ServerAnswer;
  firstContact: FirstContactState;
}) {
  const permission = useCallPermission();
  const [view, setView] = useState<View>('home');

  useEffect(() => {
    if (view === 'home') {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setView('home');
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [view]);

  const back = () => {
    setView('home');
  };
  switch (view) {
    case 'home':
      return (
        <HomeView
          server={server}
          firstContact={firstContact}
          permission={permission}
          open={setView}
        />
      );
    case 'setup':
      return (
        <FirstContactScreen
          current={firstContact.kind === 'set' ? firstContact.contact : null}
          permission={permission}
          onDone={back}
        />
      );
    case 'invite':
      return <InviteScreen onBack={back} />;
    case 'members':
      return <MembersScreen onBack={back} />;
  }
}

export function HomeScreen() {
  const { t } = useTranslation();
  const { state } = useGroupSession();

  switch (state.phase) {
    case 'starting':
      // Only while secure storage is read: 112 is above it (CALL-02-AC1).
      return <Waiting label={t('grp.waiting')} />;
    case 'joining':
      return <JoinScreen signedOut={state.signedOut} />;
    case 'home':
      return <HomeArea server={state.server} firstContact={state.firstContact} />;
  }
}

const styles = StyleSheet.create({
  firstContact: {
    fontSize: 24,
    fontWeight: '600',
    color: palette.text,
  },
  number: {
    fontSize: 20,
    color: palette.text,
  },
});
