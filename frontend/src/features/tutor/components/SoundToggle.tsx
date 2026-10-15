import { cx } from '@/shared/components/ui';
import { VolumeIcon } from './icons';
import { setSoundEnabled, useSoundEnabled } from './sound';

/** The speaker in the header. Game sounds are off until a student turns them on. */
export function SoundToggle() {
  const on = useSoundEnabled();

  return (
    <button
      type="button"
      onClick={() => setSoundEnabled(!on)}
      aria-pressed={on}
      title={on ? 'Sound on. Click to mute.' : 'Sound off. Click to turn game sounds on.'}
      className={cx(
        'flex size-[30px] items-center justify-center rounded-full border transition-colors',
        on
          ? 'border-brand bg-brand-wash text-brand'
          : 'border-line text-ink-faint hover:border-line-strong hover:text-ink',
      )}
    >
      <VolumeIcon muted={!on} className="size-[16px]" />
      <span className="sr-only">{on ? 'Mute game sounds' : 'Turn on game sounds'}</span>
    </button>
  );
}
