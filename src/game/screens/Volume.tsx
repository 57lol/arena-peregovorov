import { ChannelSlider } from '../audio/SoundControls'

/**
 * Громкость в меню встречи: голос собеседника (тот же ползунок, что раньше), музыка и звуки.
 * Меняют звук сразу, даже посреди реплики, и запоминаются.
 */
export function VolumeSlider({ className = 'w3-menu-item w3-volume' }: { className?: string }) {
  return (
    <>
      <ChannelSlider ch="voice" className={className} />
      <ChannelSlider ch="music" className={className} />
      <ChannelSlider ch="sfx" className={className} />
    </>
  )
}
