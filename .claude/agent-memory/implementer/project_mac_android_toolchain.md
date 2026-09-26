---
name: mac-android-toolchain
description: On claude-dev the default JAVA_HOME (Android Studio's JBR 25) breaks the app's native build; a JDK 17 lives in ~/jdks, and the Pixel_8 AVD is now set to nb-NO
metadata:
  type: project
---

Found running INF-06's L7 and dev build on the Mac (`claude-dev`, 2026-09-25):

- **JBR 25 fails the Android build.** With `JAVA_HOME` at Android Studio's JBR 25, `./gradlew :app:assembleRelease` fails in every `configureCMake…[x86_64]` task with `WARNING: A restricted method in java.lang.System has been called` (JDK 24+ native access), after about 18 minutes. The spec's R14 predicted it. **Temurin 17.0.20.1** is unpacked, checksum-verified, at `~/jdks/jdk-17.0.20.1+1/Contents/Home`. Prefix Android builds with `JAVA_HOME="$HOME/jdks/jdk-17.0.20.1+1/Contents/Home"`. `~/.zshrc` was not changed. CI uses setup-java 17 and is not affected.
- **The `Pixel_8` AVD's language is now nb-NO.** It was booted with `-change-locale nb-NO`, because `e2e:android` refuses any other locale. Boot it headless with `emulator -avd Pixel_8 -no-window -no-audio -no-boot-anim -no-snapshot-save -gpu swiftshader_indirect`. The first boot took 84 s.
- **Stop Colima before booting the emulator** (16 GB, spec R14), and `colima start` afterwards. gate:full's integration step needs Docker.
- The pinned Maestro is cached at `node_modules/.cache/maestro/2.10.0/` (315 MB download, about 2 min).
- Warm release build: about 1.5 to 2 minutes. A full `pnpm run e2e:android` takes about 2 minutes with caches warm.

**Why:** each of these cost a slow round trip to find.

**How to apply:** for any L7 or dev-build work on the Mac, use the JDK 17 path above, and say in the report that the machine's default Java cannot build the app. Suggest the owner point `JAVA_HOME` at a JDK 17 (a `doctor` check could catch it). Related: [[stale-git-on-path]].
