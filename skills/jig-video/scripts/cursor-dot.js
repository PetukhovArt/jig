(() => {
  if (window.__fvCursor) return
  const dot = document.createElement('div')
  dot.id = 'fv-cursor'
  dot.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(255,200,0,.6);border:2px solid #fff;box-shadow:0 0 6px #000;left:50vw;top:50vh;transition:left .5s ease-in-out,top .5s ease-in-out'
  document.documentElement.append(dot)
  addEventListener('mousemove', (event) => {
    dot.style.left = `${event.clientX}px`
    dot.style.top = `${event.clientY}px`
  }, true)
  const glideTo = async (x, y) => {
    dot.style.left = `${x}px`
    dot.style.top = `${y}px`
    await new Promise((resolve) => setTimeout(resolve, 650))
  }
  window.__fvCursor = {
    to: glideTo,
    toElement: (element) => {
      const rect = element.getBoundingClientRect()
      return glideTo(rect.x + rect.width / 2, rect.y + rect.height / 2)
    },
  }
})()
