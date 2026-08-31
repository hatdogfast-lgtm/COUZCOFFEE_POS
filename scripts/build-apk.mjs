/**
 * Builds the Android APK.
 *
 * Finds the Android SDK and a JDK itself and passes them to Gradle, rather
 * than depending on JAVA_HOME being set in whatever shell happens to be
 * running. A fresh checkout on a machine with Android Studio installed builds
 * with one command and no environment setup.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = path.join(ROOT, 'packages', 'web')
const ANDROID = path.join(WEB, 'android')
const isWindows = process.platform === 'win32'

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

function existing(candidates) {
  return candidates.filter(Boolean).find((entry) => fs.existsSync(entry))
}

// ------------------------------------------------------------- Android SDK --

const sdk = existing([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
  process.env.HOME && path.join(process.env.HOME, 'Library', 'Android', 'sdk'),
  process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk'),
])

if (!sdk) {
  fail(
    'No Android SDK found.\n' +
      'Install Android Studio (which includes it), or set ANDROID_HOME to an existing SDK.',
  )
}

// ---------------------------------------------------------------------- JDK --

/** Gradle needs a full JDK, version 17 or newer, not just a runtime. */
function looksLikeJdk(home) {
  const binary = path.join(home, 'bin', isWindows ? 'java.exe' : 'java')
  return fs.existsSync(binary)
}

function searchForJdks(parent) {
  if (!parent || !fs.existsSync(parent)) return []
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /jdk|temurin|zulu|corretto|openjdk/i.test(entry.name))
      .map((entry) => path.join(parent, entry.name))
  } catch {
    return []
  }
}

const jdkCandidates = [
  process.env.JAVA_HOME,
  // Android Studio ships its own JDK, which is the one it builds with.
  isWindows ? 'C:\\Program Files\\Android\\Android Studio\\jbr' : null,
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  ...searchForJdks(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft')),
  ...searchForJdks(isWindows ? 'C:\\Program Files\\Microsoft' : null),
  ...searchForJdks(isWindows ? 'C:\\Program Files\\Java' : null),
  ...searchForJdks(isWindows ? 'C:\\Program Files\\Eclipse Adoptium' : null),
  ...searchForJdks('/usr/lib/jvm'),
  ...searchForJdks('/Library/Java/JavaVirtualMachines'),
]

const jdk = jdkCandidates.filter(Boolean).find(looksLikeJdk)

if (!jdk) {
  fail(
    'No JDK found.\n' +
      'Gradle needs a JDK 17 or newer. Install one with:\n\n' +
      '  winget install Microsoft.OpenJDK.17\n\n' +
      'or install Android Studio, which bundles one. Then run this again.',
  )
}

// --------------------------------------------------------------------- build --

fs.writeFileSync(
  path.join(ANDROID, 'local.properties'),
  `sdk.dir=${sdk.split(path.sep).join('\\\\')}\n`,
)

console.log(`Android SDK  ${sdk}`)
console.log(`JDK          ${jdk}\n`)

const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk }

/**
 * Every step here is a batch file or shell script on at least one platform, so
 * these run through a shell. The command is assembled as one string rather
 * than a string plus an argument array, which the shell would concatenate
 * without escaping anyway.
 */
function run(command, cwd) {
  const result = spawnSync(command, { cwd, env, stdio: 'inherit', shell: true })
  if (result.status !== 0) fail(`Failed: ${command}`)
}

console.log('Building the web bundle…')
run('npm run build', WEB)

console.log('\nCopying it into the Android project…')
run('npx cap sync android', WEB)

console.log('\nAssembling the APK…')
// An absolute path: Windows cmd does not resolve a bare script name from the
// working directory the way a POSIX shell would with ./
const gradlew = path.join(ANDROID, isWindows ? 'gradlew.bat' : 'gradlew')
run(`"${gradlew}" assembleDebug`, ANDROID)

const apk = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
if (!fs.existsSync(apk)) fail('Gradle reported success but no APK was produced.')

const megabytes = (fs.statSync(apk).size / 1024 / 1024).toFixed(1)
console.log(`\nAPK ready (${megabytes} MB):\n  ${apk}\n`)
console.log('Copy it to an Android device and open it, or install over USB with:')
console.log(`  "${path.join(sdk, 'platform-tools', 'adb')}" install -r "${apk}"`)
