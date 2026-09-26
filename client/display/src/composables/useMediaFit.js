import { ref } from 'vue';

export function useMediaFit() {
  const mediaStyle = ref({ left: '0px', top: '0px', width: '100%', height: '100%' });

  function computeFit(mediaWidth, mediaHeight, wrapWidth, wrapHeight) {
    if (!mediaWidth || !mediaHeight || !wrapWidth || !wrapHeight) return;
    const ir = mediaWidth / mediaHeight;
    const wr = wrapWidth / wrapHeight;
    let w, h, l, t;
    if (ir > wr) { w = wrapWidth;  h = wrapWidth / ir;  l = 0;                   t = (wrapHeight - h) / 2; }
    else         { h = wrapHeight; w = wrapHeight * ir;  l = (wrapWidth - w) / 2; t = 0;                    }
    mediaStyle.value = { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' };
  }

  return { mediaStyle, computeFit };
}
