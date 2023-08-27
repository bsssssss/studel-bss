/*
pianoroll.mjs - <short description TODO>
Copyright (C) 2022 Strudel contributors - see <https://github.com/tidalcycles/strudel/blob/main/packages/core/pianoroll.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Pattern, noteToMidi, getDrawContext, freqToMidi, isNote } from './index.mjs';

const scale = (normalized, min, max) => normalized * (max - min) + min;
const getValue = (e) => {
  let { value } = e;
  if (typeof e.value !== 'object') {
    value = { value };
  }
  let { note, n, freq, s } = value;
  if (freq) {
    return freqToMidi(freq);
  }
  note = note ?? n;
  if (typeof note === 'string') {
    return noteToMidi(note);
  }
  if (typeof note === 'number') {
    return note;
  }
  if (s) {
    return '_' + s;
  }
  return value;
};

Pattern.prototype.pianoroll = function (options = {}) {
  let { cycles = 4, playhead = 0.5, overscan = 1, hideNegative = false } = options;

  let from = -cycles * playhead;
  let to = cycles * (1 - playhead);

  this.draw(
    (ctx, haps, t) => {
      const inFrame = (event) =>
        (!hideNegative || event.whole.begin >= 0) && event.whole.begin <= t + to && event.endClipped >= t + from;
      pianoroll({
        ...options,
        time: t,
        ctx,
        haps: haps.filter(inFrame),
      });
    },
    {
      from: from - overscan,
      to: to + overscan,
    },
  );
  return this;
};

// this function allows drawing a pianoroll without ties to Pattern.prototype
// it will probably replace the above in the future
export function pianoroll({
  time,
  haps,
  cycles = 4,
  playhead = 0.5,
  flipTime = 0,
  flipValues = 0,
  hideNegative = false,
  // inactive = '#C9E597',
  // inactive = '#FFCA28',
  inactive = '#7491D2',
  active = '#FFCA28',
  // background = '#2A3236',
  background = 'transparent',
  smear = 0,
  playheadColor = 'white',
  minMidi = 10,
  maxMidi = 90,
  autorange = 0,
  timeframe: timeframeProp,
  fold = 0,
  vertical = 0,
  labels = false,
  fill = 1,
  fillActive = false,
  strokeActive = true,
  stroke,
  hideInactive = 0,
  colorizeInactive = 1,
  fontFamily,
  ctx,
} = {}) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  let from = -cycles * playhead;
  let to = cycles * (1 - playhead);

  if (timeframeProp) {
    console.warn('timeframe is deprecated! use from/to instead');
    from = 0;
    to = timeframeProp;
  }
  const timeAxis = vertical ? h : w;
  const valueAxis = vertical ? w : h;
  let timeRange = vertical ? [timeAxis, 0] : [0, timeAxis]; // pixel range for time
  const timeExtent = to - from; // number of seconds that fit inside the canvas frame
  const valueRange = vertical ? [0, valueAxis] : [valueAxis, 0]; // pixel range for values
  let valueExtent = maxMidi - minMidi + 1; // number of "slots" for values, overwritten if autorange true
  let barThickness = valueAxis / valueExtent; // pixels per value, overwritten if autorange true
  let foldValues = [];
  flipTime && timeRange.reverse();
  flipValues && valueRange.reverse();

  // onQuery
  const { min, max, values } = haps.reduce(
    ({ min, max, values }, e) => {
      const v = getValue(e);
      return {
        min: v < min ? v : min,
        max: v > max ? v : max,
        values: values.includes(v) ? values : [...values, v],
      };
    },
    { min: Infinity, max: -Infinity, values: [] },
  );
  if (autorange) {
    minMidi = min;
    maxMidi = max;
    valueExtent = maxMidi - minMidi + 1;
  }
  // foldValues = values.sort((a, b) => a - b);
  foldValues = values.sort((a, b) => String(a).localeCompare(String(b)));
  barThickness = fold ? valueAxis / foldValues.length : valueAxis / valueExtent;
  ctx.fillStyle = background;
  ctx.globalAlpha = 1; // reset!
  if (!smear) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillRect(0, 0, w, h);
  }
  haps.forEach((event) => {
    const isActive = event.whole.begin <= time && event.endClipped > time;
    let strokeCurrent = stroke ?? (strokeActive && isActive);
    let fillCurrent = (!isActive && fill) || (isActive && fillActive);
    if (hideInactive && !isActive) {
      return;
    }
    let color = event.value?.color || event.context?.color;
    active = color || active;
    inactive = colorizeInactive ? color || inactive : inactive;
    color = isActive ? active : inactive;
    ctx.fillStyle = fillCurrent ? color : 'transparent';
    ctx.strokeStyle = color;
    ctx.globalAlpha = event.context.velocity ?? event.value?.gain ?? 1;
    const timeProgress = (event.whole.begin - (flipTime ? to : from)) / timeExtent;
    const timePx = scale(timeProgress, ...timeRange);
    let durationPx = scale(event.duration / timeExtent, 0, timeAxis);
    const value = getValue(event);
    const valueProgress = fold
      ? foldValues.indexOf(value) / foldValues.length
      : (Number(value) - minMidi) / valueExtent;
    const valuePx = scale(valueProgress, ...valueRange);
    let margin = 0;
    const offset = scale(time / timeExtent, ...timeRange);
    let coords;
    if (vertical) {
      coords = [
        valuePx + 1 - (flipValues ? barThickness : 0), // x
        timeAxis - offset + timePx + margin + 1 - (flipTime ? 0 : durationPx), // y
        barThickness - 2, // width
        durationPx - 2, // height
      ];
    } else {
      coords = [
        timePx - offset + margin + 1 - (flipTime ? durationPx : 0), // x
        valuePx + 1 - (flipValues ? 0 : barThickness), // y
        durationPx - 2, // widith
        barThickness - 2, // height
      ];
    }
    /* const xFactor = Math.sin(performance.now() / 500) + 1;
      coords[0] *= xFactor; */

    if (strokeCurrent) {
      ctx.strokeRect(...coords);
    }
    if (fillCurrent) {
      ctx.fillRect(...coords);
    }
    //ctx.ellipse(...ellipseFromRect(...coords))
    if (labels) {
      const defaultLabel = event.value.note ?? event.value.s + (event.value.n ? `:${event.value.n}` : '');
      const { label: inactiveLabel, activeLabel } = event.value;
      const customLabel = isActive ? activeLabel || inactiveLabel : inactiveLabel;
      const label = customLabel ?? defaultLabel;
      let measure = vertical ? durationPx : barThickness * 0.75;
      ctx.font = `${measure}px ${fontFamily || 'monospace'}`;
      // font color
      ctx.fillStyle = /* isActive &&  */ !fillCurrent ? color : 'black';
      ctx.textBaseline = 'top';
      ctx.fillText(label, ...coords);
    }
  });
  ctx.globalAlpha = 1; // reset!
  const playheadPosition = scale(-from / timeExtent, ...timeRange);
  // draw playhead
  ctx.strokeStyle = playheadColor;
  ctx.beginPath();
  if (vertical) {
    ctx.moveTo(0, playheadPosition);
    ctx.lineTo(valueAxis, playheadPosition);
  } else {
    ctx.moveTo(playheadPosition, 0);
    ctx.lineTo(playheadPosition, valueAxis);
  }
  ctx.stroke();
  return this;
}

export function getDrawOptions(drawTime, options = {}) {
  let [lookbehind, lookahead] = drawTime;
  lookbehind = Math.abs(lookbehind);
  const cycles = lookahead + lookbehind;
  const playhead = lookbehind / cycles;
  return { fold: 1, ...options, cycles, playhead };
}

Pattern.prototype.punchcard = function (options) {
  return this.onPaint((ctx, time, haps, drawTime, paintOptions = {}) =>
    pianoroll({ ctx, time, haps, ...getDrawOptions(drawTime, { ...paintOptions, ...options }) }),
  );
};

Pattern.prototype.wordfall = function (options) {
  return this.punchcard({ vertical: 1, labels: 1, stroke: 0, fillActive: 1, active: 'white', ...options });
};

/* Pattern.prototype.pianoroll = function (options) {
  return this.onPaint((ctx, time, haps, drawTime) =>
    pianoroll({ ctx, time, haps, ...getDrawOptions(drawTime, { fold: 0, ...options }) }),
  );
}; */

export function drawPianoroll(options) {
  const { drawTime, ...rest } = options;
  pianoroll({ ...getDrawOptions(drawTime), ...rest });
}
