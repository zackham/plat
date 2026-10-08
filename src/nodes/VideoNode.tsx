import { useEffect, useRef, useState } from "react"
import { Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react"
import { platInteractive } from "../nodeTypes"
import { videoPlayback, type AnyNode, type VideoNode } from "../types"

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, "0")}`
}

// Video renders as a real <video> in the node box. The body stays a plain
// node surface (drag in the editor, pan in view mode); only the play button
// and the control bar are interactive regions, so playback never fights with
// selection. Every node stays mounted (no culling), so playback is tied to
// visibility: loop clips play only while on screen, and anything that scrolls
// off screen pauses.
export function VideoContent({ node: raw }: { node: AnyNode; readOnly: boolean }) {
  const n = raw as VideoNode
  const mode = videoPlayback(n)
  const loop = mode === "loop"
  const rootRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  // loop clips are muted (autoplay requires it); click clips start with sound
  const [muted, setMuted] = useState(loop)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(n.duration ?? 0)
  const [failed, setFailed] = useState(false)

  useEffect(() => setMuted(loop), [loop])
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])
  useEffect(() => setFailed(false), [n.src])

  const play = () => {
    const v = videoRef.current
    if (!v) return
    try {
      const p = v.play()
      if (p && typeof p.catch === "function") p.catch(() => {})
    } catch {
      /* playback unsupported (e.g. jsdom) */
    }
  }
  const pause = () => {
    const v = videoRef.current
    if (v && !v.paused) v.pause()
  }

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (!entry.isIntersecting) pause()
        else if (loop) play()
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loop, n.src])

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) play()
    else v.pause()
  }

  const fullscreen = () => {
    const v = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null
    if (!v) return
    if (v.requestFullscreen) {
      v.controls = true
      v.muted = false
      setMuted(false)
      void v.requestFullscreen().catch(() => {
        v.controls = false
      })
    } else {
      v.webkitEnterFullscreen?.() // iOS Safari
    }
  }

  useEffect(() => {
    const onChange = () => {
      const v = videoRef.current
      if (v && document.fullscreenElement !== v) v.controls = false
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const showAudio = n.hasAudio !== false
  const cls = [
    "plat-video",
    `plat-video--${mode}`,
    playing ? "is-playing" : "",
    started ? "is-started" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div ref={rootRef} className={cls}>
      <video
        ref={videoRef}
        className="plat-video__media"
        src={n.src}
        poster={n.poster}
        muted={muted}
        loop={loop}
        playsInline
        preload="metadata"
        draggable={false}
        onPlay={() => {
          setPlaying(true)
          setStarted(true)
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d)) setDuration(d)
        }}
        onError={() => setFailed(true)}
      />
      {failed ? (
        <div className="plat-video__error">video unavailable</div>
      ) : (
        <>
          {!loop && !playing && (
            <button
              type="button"
              className="plat-video__play"
              aria-label="Play video"
              {...platInteractive}
              onClick={(e) => {
                e.stopPropagation()
                play()
              }}
            >
              <Play size={28} fill="currentColor" />
            </button>
          )}
          <div className="plat-video__bar" {...platInteractive}>
            <button
              type="button"
              className="plat-video__btn"
              aria-label={playing ? "Pause" : "Play"}
              onClick={toggle}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <span className="plat-video__time">{fmtTime(time)}</span>
            <input
              type="range"
              className="plat-video__scrub"
              aria-label="Seek"
              min={0}
              max={duration || 0}
              step="any"
              value={Math.min(time, duration || 0)}
              onChange={(e) => {
                const t = Number(e.target.value)
                if (videoRef.current) videoRef.current.currentTime = t
                setTime(t)
              }}
            />
            <span className="plat-video__time">{fmtTime(duration)}</span>
            {showAudio && (
              <button
                type="button"
                className="plat-video__btn"
                aria-label={muted ? "Unmute" : "Mute"}
                onClick={() => setMuted(!muted)}
              >
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            )}
            <button
              type="button"
              className="plat-video__btn"
              aria-label="Fullscreen"
              onClick={fullscreen}
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
