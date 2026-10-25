/**
 * CALL-01 and CALL-02's public interface: the 112 bar every screen draws, the
 * call button, and Android's call permission as the home screen and the setup
 * screen need it. Other code reaches the feature through this file and
 * nothing else (AR-10), and the feature reaches no other feature and not the
 * safety core (CALL-01-AC6, an import rule): calling needs no server and no
 * journey.
 */
export { CallButton, spelledNumber, type Callee, type CallButtonProps } from './call-button';
export { EmergencyBar } from './emergency-bar';
export { CallPermissionLine, useCallPermission, type CallPermissionState } from './permission';
