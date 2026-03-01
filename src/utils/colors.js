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

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class ProgressBar {
  constructor(total, options = {}) {
    this.total = total;
    this.current = 0;
    this.startTime = Date.now();
    this.lastUpdate = 0;
    this.spinnerIndex = 0;
    this.spinnerInterval = null;
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
    this.render(true);
  }

  increment() {
    this.current++;
    this.render(true);
  }

  stop() {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.render(true);
    console.log();
  }

  render(clear = false) {
    const now = Date.now();
    if (!clear && now - this.lastUpdate < 50) return;
    this.lastUpdate = now;

    const percentage = this.total > 0 ? Math.floor((this.current / this.total) * 100) : 0;
    const filledWidth = this.total > 0 ? Math.floor((this.current / this.total) * this.options.width) : 0;
    const emptyWidth = this.options.width - filledWidth;
    
    const bar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);
    const spinner = this.spinnerInterval ? spinnerFrames[this.spinnerIndex] : '✓';
    
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
