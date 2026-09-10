const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',

  fg: {
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
  },

  bg: {
    black: '\x1b[40m',
    red: '\x1b[41m',
    green: '\x1b[42m',
    yellow: '\x1b[43m',
    blue: '\x1b[44m',
    magenta: '\x1b[45m',
    cyan: '\x1b[46m',
    white: '\x1b[47m'
  }
};

function wrap(color, text) {
  return `${color}${text}${colors.reset}`;
}

export function cyan(text) {
  return wrap(colors.fg.cyan, text);
}

export function yellow(text) {
  return wrap(colors.fg.yellow, text);
}

export function green(text) {
  return wrap(colors.fg.green, text);
}

export function red(text) {
  return wrap(colors.fg.red, text);
}

export function gray(text) {
  return wrap(colors.fg.gray, text);
}

export function blue(text) {
  return wrap(colors.fg.blue, text);
}

export function magenta(text) {
  return wrap(colors.fg.magenta, text);
}

export function white(text) {
  return wrap(colors.fg.white, text);
}

export function bold(text) {
  return wrap(colors.bright, text);
}

export function dim(text) {
  return wrap(colors.dim, text);
}

export function underline(text) {
  return wrap(colors.underscore, text);
}

export function bgGreen(text) {
  return wrap(colors.bg.green, text);
}

export function bgRed(text) {
  return wrap(colors.bg.red, text);
}

export function bgYellow(text) {
  return wrap(colors.bg.yellow, text);
}

export function bgCyan(text) {
  return wrap(colors.bg.cyan, text);
}

const spinnerFrames = ['-', '\\', '|', '/'];

/**
 * Whether a human is plausibly reading stdout.
 *
 * `process.stdout.isTTY` is the primary signal, but it is not sufficient on
 * Windows: mintty (Git Bash / MSYS2) runs native programs against a pipe
 * instead of a Windows console, so Node reports no TTY even though a terminal
 * is attached and drawing frames works fine. Those shells mark the environment
 * with MSYSTEM plus a real TERM. The trade-off is that redirecting output from
 * such a shell inherits both too; `--quiet` and `--no-progress` are the way to
 * ask for a clean stream.
 */
export function stdoutIsTerminal(stream = process.stdout, env = process.env, platform = process.platform) {
  if (stream?.isTTY === true) return true;
  if (platform !== 'win32') return false;
  const term = env.TERM;
  return Boolean(env.MSYSTEM) && typeof term === 'string' && term !== '' && term !== 'dumb';
}

export class ProgressBar {
  constructor(total, options = {}) {
    this.total = total;
    this.current = 0;
    this.startTime = Date.now();
    this.lastUpdate = 0;
    this.spinnerIndex = 0;
    this.spinnerInterval = null;
    // Progress is a terminal affordance. When stdout is piped or redirected
    // (CI, `| wc -l`) nobody reads the frames, and each one is a synchronous
    // console write - notably expensive on Windows - so draw nothing at all.
    this.isInteractive = stdoutIsTerminal();
    this.options = {
      width: 40,
      showSpinner: true,
      showPercentage: true,
      showCount: true,
      showElapsed: true,
      ...options
    };
  }

  start() {
    if (!this.isInteractive) return;
    if (this.options.showSpinner) {
      this.spinnerInterval = setInterval(() => {
        this.spinnerIndex = (this.spinnerIndex + 1) % spinnerFrames.length;
        this.render(false);
      }, 100);
    }
    this.render(true);
  }

  update(current) {
    this.current = current;
    this.render(false);
  }

  increment() {
    this.current++;
    this.render(false);
  }

  stop() {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    if (!this.isInteractive) return;
    // Force the closing frame so the bar always ends on its final state.
    this.render(true);
    console.log();
  }

  /** `clear` also erases the line first; reserved for the first/last frame. */
  render(clear = false) {
    if (!this.isInteractive) return;
    const now = Date.now();
    if (!clear && now - this.lastUpdate < 50) return;
    this.lastUpdate = now;

    const percentage = this.total > 0 ? Math.floor((this.current / this.total) * 100) : 0;
    const filledWidth = this.total > 0 ? Math.floor((this.current / this.total) * this.options.width) : 0;
    const emptyWidth = this.options.width - filledWidth;

    const bar = '#'.repeat(filledWidth) + '-'.repeat(emptyWidth);
    const spinner = this.spinnerInterval ? spinnerFrames[this.spinnerIndex] : 'o';

    let output = '';

    if (this.options.showSpinner) {
      output += `${cyan(spinner)} `;
    }

    output += `[${green(bar)}]`;

    if (this.options.showPercentage) {
      output += ` ${bold(`${percentage}%`)}`;
    }

    if (this.options.showCount) {
      output += ` ${dim(`(${this.current}/${this.total})`)}`;
    }

    if (this.options.showElapsed) {
      const elapsed = Math.floor((now - this.startTime) / 1000);
      output += ` ${gray(`[${elapsed}s]`)}`;
    }

    if (clear) {
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80));
    }
    process.stdout.write('\r' + output);
  }
}

export function clearLine() {
  if (!stdoutIsTerminal()) return;
  process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
}

export function moveCursorUp(count = 1) {
  process.stdout.write(`\x1b[${count}A`);
}

export function moveCursorDown(count = 1) {
  process.stdout.write(`\x1b[${count}B`);
}

export function eraseToEnd() {
  process.stdout.write('\x1b[K');
}

export function saveCursor() {
  process.stdout.write('\x1b[s');
}

export function restoreCursor() {
  process.stdout.write('\x1b[u');
}
