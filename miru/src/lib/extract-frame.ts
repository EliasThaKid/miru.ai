// Client-only helper (uses DOM APIs — callers are 'use client' components).
// Captures the final frame of a moment's animated clip so a Generated Bridge can start
// where the animation actually ends, instead of jumping back to the moment's still image.
// Canvas capture requires the video host to allow cross-origin reads (fal.media does).
export function extractLastFrame(videoUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true

    const fail = (message: string) => reject(new Error(message))

    video.onerror = () => fail("Couldn't load the moment's video to capture its final frame. Please try again.")
    video.onloadedmetadata = () => {
      // Seeking to the exact duration can yield an empty frame in some browsers.
      video.currentTime = Math.max(0, video.duration - 0.05)
    }
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return fail("Couldn't capture the video's final frame. Please try again.")
        ctx.drawImage(video, 0, 0)
        resolve(canvas.toDataURL('image/jpeg', 0.9))
      } catch {
        fail("Couldn't capture the video's final frame (the video host blocked cross-origin access).")
      }
    }

    video.src = videoUrl
  })
}
