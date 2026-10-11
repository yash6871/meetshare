// Steady timer for the camera effects loop. Unlike requestAnimationFrame / setInterval on the page,
// a worker keeps ticking when the tab is in the background, so other people still see your video.
let id = null;
onmessage = (e) => {
  clearInterval(id);
  if (e.data > 0) id = setInterval(() => postMessage(0), e.data);
};
