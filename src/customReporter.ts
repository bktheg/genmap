import stringWidth from "string-width";
import { ConsolaOptions, ConsolaReporter, LogLevel, LogType, FormatOptions, LogObject } from "consola";
import { formatWithOptions } from "node:util";
import { sep } from "node:path";
import chalk from 'chalk'
import isUnicodeSupported from 'is-unicode-supported'

const {cyan,gray,black,white,bgWhite} = chalk

/////////////////////////////////////////////////////////////////
//
// Based on consola fancy reporter
// https://github.com/unjs/consola
// License: MIT
//
/////////////////////////////////////////////////////////////////

export const TYPE_COLOR_MAP: { [k in LogType]?: string } = {
  info: "cyan",
  fail: "red",
  success: "green",
  ready: "green",
  start: "magenta",
};

export const LEVEL_COLOR_MAP: { [k in LogLevel]?: string } = {
  0: "red",
  1: "yellow",
};

const unicode = isUnicodeSupported();
const s = (c: string, fallback: string) => (unicode ? c : fallback);
const TYPE_ICONS: { [k in LogType]?: string } = {
  error: s("✖", "×"),
  fatal: s("✖", "×"),
  ready: s("✔", "√"),
  warn: s("⚠", "‼"),
  info: s("ℹ", "i"),
  success: s("✔", "√"),
  debug: s("⚙", "D"),
  trace: s("→", "→"),
  fail: s("✖", "×"),
  start: s("◐", "o"),
  log: "",
};

export class CustomFancyReporter implements ConsolaReporter {
  formatStack(stack: string) {
    return (
      "\n" +
      parseStack(stack)
        .map(
          (line) =>
            "  " +
            line
              .replace(/^at +/, (m) => gray(m))
              .replace(/\((.+)\)/, (_, m) => `(${cyan(m)})`)
        )
        .join("\n")
    );
  }

  formatType(logObj: LogObject, isBadge: boolean, opts: FormatOptions) {
    const typeColor =
      (TYPE_COLOR_MAP as any)[logObj.type] ||
      (LEVEL_COLOR_MAP as any)[logObj.level] ||
      "gray";

    if (isBadge) {
      return getBgColor(typeColor)(
        black(` ${logObj.type.toUpperCase()} `)
      );
    }

    const _type =
      typeof (TYPE_ICONS as any)[logObj.type] === "string"
        ? (TYPE_ICONS as any)[logObj.type]
        : (logObj as any).icon || logObj.type;

    return _type ? getColor(typeColor)(_type) : "";
  }

  formatLogObj(logObj: LogObject, opts: FormatOptions) {
    const [message, ...additional] = this.formatArgs(logObj.args, opts).split(
      "\n"
    );

    const isBadge = (logObj as any).badge;
    const messageColor = logObj.level < 2 ? (TYPE_COLOR_MAP as any)[logObj.type] ||
        (LEVEL_COLOR_MAP as any)[logObj.level] || "white" : "white";

    const date = this.formatDate(logObj.date, opts);
    const coloredDate = date && gray(date);

    const type = this.formatType(logObj, isBadge, opts);

    const tag = logObj.tag ? gray(logObj.tag) : "";

    const left = this.filterAndJoin([type, getColor(messageColor)(highlightBackticks(message))]);
    const right = this.filterAndJoin(opts.columns ? [tag, coloredDate] : [tag]);
    const space =
      (opts.columns || 0) - stringWidth(left) - stringWidth(right) - 2;

    let line =
      space > 0 && (opts.columns || 0) >= 80
        ? left + " ".repeat(space) + right
        : (right ? `${gray(`[${right}]`)} ` : "") + left;

    line += highlightBackticks(
      additional.length > 0 ? "\n" + additional.join("\n") : ""
    );

    if (logObj.type === "trace") {
      const _err = new Error("Trace: " + logObj.message);
      line += this.formatStack(_err.stack || "");
    }

    return line;
  }

  formatArgs(args: any[], opts: FormatOptions) {
    const _args = args.map((arg) => {
      if (arg && typeof arg.stack === "string") {
        return arg.message + "\n" + this.formatStack(arg.stack);
      }
      return arg;
    });

    // Only supported with Node >= 10
    // https://nodejs.org/api/util.html#util_util_inspect_object_options
    return formatWithOptions(opts, ..._args);
  }

  formatDate(date: Date, opts: FormatOptions) {
    return opts.date ? date.toLocaleTimeString() : "";
  }

  filterAndJoin(arr: any[]) {
    return arr.filter(Boolean).join(" ");
  }

  log(logObj: LogObject, ctx: { options: ConsolaOptions }) {
    const line = this.formatLogObj(logObj, {
      columns: (ctx.options.stdout as any).columns || 0,
      ...ctx.options.formatOptions,
    });

    return writeStream(
      line + "\n",
      logObj.level < 2
        ? ctx.options.stderr || process.stderr
        : ctx.options.stdout || process.stdout
    );
  }
}

function highlightBackticks(str: string) {
  return str.replace(/`([^`]+)`/gm, (_, m) => cyan(m));
}

function getColor(color = "white") {
  return (chalk as any)[color] || white;
}

function getBgColor(color = "bgWhite") {
  return (
    (chalk as any)[`bg${color[0].toUpperCase()}${color.slice(1)}`] ||
    bgWhite
  );
}

export function writeStream(data: any, stream: NodeJS.WriteStream) {
    const write = (stream as any).__write || stream.write;
    return write.call(stream, data);
}

export function parseStack(stack: string) {
  const cwd = process.cwd() + sep;

  const lines = stack
    .split("\n")
    .splice(1)
    .map((l) => l.trim().replace("file://", "").replace(cwd, ""));

  return lines;
}