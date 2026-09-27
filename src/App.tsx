import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Heart,
  Shuffle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  LogOut,
  SlidersHorizontal,
  Download,
  X,
  Sparkles,
  LockKeyhole,
  ArrowRight,
  Plus,
} from 'lucide-react';
import { Booth } from './booth';
import { Stage } from './Stage';
import { Decorate } from './Decorate';
import { PoseSheet } from './PoseSheet';
import { references } from './references';
import { colors, decoratePhoto, makeStrip, saveImage } from './render';
import { blobFromCanvas } from './media';
import type { Scene } from '../shared/protocol';

const booth = new Booth();
const noDecorations: import('../shared/protocol').Decoration[] = [];
const initialInvite = new URLSearchParams(location.hash.slice(1));
const inviteRoom = initialInvite.get('room'),
  inviteToken = initialInvite.get('invite');
if (location.hash) history.replaceState(null, '', location.pathname);

function Photo({
  blob,
  alt,
  decorations = noDecorations,
}: {
  blob: Blob;
  alt: string;
  decorations?: import('../shared/protocol').Decoration[];
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let current = '',
      cancelled = false;
    void decoratePhoto(blob, decorations)
      .then(blobFromCanvas)
      .then((b) => {
        if (!cancelled) {
          current = URL.createObjectURL(b);
          setUrl(current);
        }
      });
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [blob, decorations]);
  return url ? <img src={url} alt={alt} /> : <span className="muted">Developing…</span>;
}
function PoseImage({ index, className = '' }: { index: number; className?: string }) {
  const reference = references[index];
  if (reference.memeImage)
    return (
      <div className={`meme-pose ${className}`}>
        <img src={reference.memeImage} alt={`${reference.title} original meme reference`} />
      </div>
    );
  return (
    <div
      role="img"
      aria-label={`${references[index].title} pose reference`}
      className={`pose-image ${className}`}
      style={{ backgroundPosition: `${((index % 4) * 100) / 3}% ${index < 4 ? 0 : 100}%` }}
    />
  );
}

export default function App() {
  const state = useSyncExternalStore(booth.subscribe, booth.snapshot);
  const { room } = state;
  const [name, setName] = useState('');
  const [settings, setSettings] = useState(false);
  const [tab, setTab] = useState<'scene' | 'position' | 'print'>('scene');
  const [category, setCategory] = useState('All poses');
  const [favorites, setFavorites] = useState<number[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('kd-favorites') || '[]');
      return Array.isArray(saved)
        ? saved.filter((i) => Number.isInteger(i) && i >= 0 && i < references.length)
        : [];
    } catch {
      return [];
    }
  });
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [selectedShot, setSelectedShot] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewPanel = useRef<HTMLElement>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const scene = room?.scene;
  const reference = scene?.reference || 0;
  const director = room?.director === state.seat;
  const canEdit = Boolean(director && !room?.capture);
  const currentPhoto = room?.capture && state.photos.get(room.capture.id);
  const me = room?.members[state.seat];
  const partner = room?.members[state.seat === 0 ? 1 : 0];
  const captureHint = !room
    ? ''
    : room.capture?.phase === 'review'
      ? 'Your photo is ready. Keep it or try again below.'
      : room.capture
        ? 'Hold your pose while the photo develops.'
        : room.shots.length >= 12
          ? 'Your booth is full. Pick four favorites below and save your strip.'
          : !state.camera
            ? 'Turn on your camera when you’re ready to step in.'
            : !partner
              ? 'Send your invitation. You can try poses while you wait.'
              : !partner.camera
                ? `Waiting for ${partner.name} to turn on their camera.`
                : !state.connected
                  ? 'Connecting your cameras. One moment…'
                  : !me?.ready
                    ? 'Happy with your pose? Tap “I’m ready”.'
                    : !partner.ready
                      ? `You’re ready! Waiting for ${partner.name}.`
                      : 'You’re both ready. Either of you can take the photo.';
  const selected = room?.shots.find((s) => s.id === selectedShot);
  const visibleReferences = references
    .map((r, i) => ({ ...r, index: i }))
    .filter(
      (r) =>
        category === 'All poses' ||
        (category === 'Favorites' ? favorites.includes(r.index) : r.category === category),
    );
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) booth.hide();
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (booth.value.photos.size) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);
  useEffect(() => {
    if (!room) {
      setSelection([]);
      setSelectedShot(null);
      return;
    }
    setSelection((prev) => {
      const valid = prev.filter((id) => room.shots.some((s) => s.id === id));
      for (const shot of room.shots)
        if (valid.length < 4 && !valid.includes(shot.id)) valid.push(shot.id);
      return valid;
    });
  }, [room?.shots.length, room?.id]);
  useEffect(() => {
    if (leaveOpen) leaveDialog.current?.showModal();
  }, [leaveOpen]);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (room?.capture?.phase !== 'review' || !currentPhoto) return;
    setReferenceOpen(false);
    reviewPanel.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [room?.capture?.id, room?.capture?.phase, currentPhoto]);
  const changeScene = (patch: Partial<Scene>) => {
    if (scene) booth.send({ type: 'scene', scene: { ...scene, ...patch } });
  };
  const choose = (index: number) => changeScene({ reference: index });
  const step = (direction: number) => {
    const list = visibleReferences.length
      ? visibleReferences
      : references.map((r, index) => ({ ...r, index }));
    const current = list.findIndex((r) => r.index === reference);
    choose(list[(current + direction + list.length) % list.length].index);
  };
  const roulette = () => {
    const options = (
      visibleReferences.length ? visibleReferences.map((r) => r.index) : references.map((_, i) => i)
    ).filter((i) => i !== reference);
    if (options.length)
      choose(options[crypto.getRandomValues(new Uint32Array(1))[0] % options.length]);
  };
  const favorite = () => {
    const next = favorites.includes(reference)
      ? favorites.filter((i) => i !== reference)
      : [...favorites, reference];
    setFavorites(next);
    try {
      localStorage.setItem('kd-favorites', JSON.stringify(next));
    } catch {
      /* Favorites can remain in memory. */
    }
  };
  const invite =
    room && state.invite ? `${location.origin}/#room=${room.id}&invite=${state.invite}` : '';
  const saveStrip = async () => {
    if (!room || selection.length !== 4) return;
    setSaving(true);
    try {
      const photos = selection.map((id) => {
        const shot = room.shots.find((s) => s.id === id)!;
        return { ...shot, blob: state.photos.get(id)! };
      });
      if (photos.some((p) => !p.blob))
        throw new Error('Wait for all photos to finish transferring.');
      await saveImage(await makeStrip(photos, room.scene), 'kdphotobooth-strip.png');
    } catch (e) {
      booth.notify(e instanceof Error ? e.message : 'Could not save your strip.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#booth-main">
        Skip to photo booth
      </a>
      <header className="site-header">
        <a
          className="wordmark"
          href="/"
          onClick={(e) => {
            if (room) e.preventDefault();
          }}
        >
          <span className="logo-mark">
            <Camera size={20} />
          </span>
          KD<span className="wordmark-light">Photo Booth</span>
        </a>
        <div className="header-right">
          <span className="privacy-badge">
            <LockKeyhole size={13} />
            Just the two of you
          </span>
          {room && (
            <button
              className="text-button"
              aria-label="Leave booth"
              onClick={() => setLeaveOpen(true)}
            >
              <LogOut size={16} />
              <span>Leave booth</span>
            </button>
          )}
        </div>
      </header>
      <main id="booth-main" tabIndex={-1}>
        <div className="page-heading">
          <div>
            <span className="eyebrow">A MOMENT WORTH KEEPING</span>
            <h1>Together in a frame.</h1>
          </div>
          <div className="connection-label" role="status">
            {room ? (
              <>
                <span className={`status-dot ${state.connected ? 'connected' : ''}`} />
                {state.connected
                  ? 'You’re both here'
                  : room.members[1]
                    ? 'Connecting…'
                    : 'Waiting for your person'}
              </>
            ) : (
              <span>Two people. Four photos. One little keepsake.</span>
            )}
          </div>
        </div>
        {state.message && (
          <div className="notice" role="status">
            <span>{state.message}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => booth.notify('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="booth-layout">
          <section className="camera-column" aria-label="Photo booth">
            <Stage booth={booth} state={state} />
            {room ? (
              <>
                <div className="seat-status" aria-label="Camera readiness">
                  {room.members.map((member, seat) => (
                    <span key={seat} className={member?.ready ? 'seat-ready' : ''}>
                      {member?.ready ? <Check size={14} /> : <Camera size={14} />}
                      <strong>{seat === state.seat ? 'You' : member?.name || 'Your person'}</strong>
                      <span>
                        {!member
                          ? 'Not here yet'
                          : !member.connected
                            ? 'Reconnecting'
                            : !member.camera
                              ? 'Camera off'
                              : member.ready
                                ? 'Ready'
                                : 'Finding a pose'}
                      </span>
                    </span>
                  ))}
                </div>
                <div className="camera-toolbar">
                  <div className="utility-controls">
                    <button
                      className="icon-button"
                      disabled={!state.stream}
                      aria-label={state.mic ? 'Mute microphone' : 'Unmute microphone'}
                      title={state.mic ? 'Mute microphone' : 'Unmute microphone'}
                      aria-pressed={!state.mic}
                      onClick={() => booth.toggleMic()}
                    >
                      {state.mic ? <Mic size={19} /> : <MicOff size={19} />}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={state.camera ? 'Turn off camera' : 'Turn on camera'}
                      title={state.camera ? 'Turn off camera' : 'Turn on camera'}
                      aria-pressed={state.camera}
                      onClick={() => booth.toggleCamera()}
                    >
                      {state.camera ? <Camera size={19} /> : <CameraOff size={19} />}
                    </button>
                    <button
                      className={`icon-button ${settings ? 'selected' : ''}`}
                      aria-label="Booth settings"
                      aria-expanded={settings}
                      aria-controls="booth-settings"
                      title="Booth settings"
                      onClick={() => setSettings(!settings)}
                    >
                      <SlidersHorizontal size={19} />
                    </button>
                  </div>
                  <button
                    className="shutter"
                    aria-describedby="capture-hint"
                    disabled={
                      !room.members.every((m) => m?.ready) ||
                      !!room.capture ||
                      !state.connected ||
                      room.shots.length >= 12
                    }
                    onClick={() => booth.send({ type: 'capture' })}
                  >
                    <Camera size={23} />
                    <span>Take a photo</span>
                  </button>
                  <button
                    className={`ready-button ${room.members[state.seat]?.ready ? 'is-ready' : ''}`}
                    aria-pressed={!!me?.ready}
                    aria-describedby="capture-hint"
                    disabled={
                      !state.connected || !state.camera || !!room.capture || room.shots.length >= 12
                    }
                    onClick={() =>
                      booth.send({ type: 'ready', ready: !room.members[state.seat]?.ready })
                    }
                  >
                    <Check size={16} />
                    {room.members[state.seat]?.ready ? 'Ready!' : 'I’m ready'}
                  </button>
                </div>
                <div className="under-controls">
                  <span id="capture-hint" role="status">
                    {captureHint}
                  </span>
                  <span>Photos stay in this session until you save them.</span>
                </div>
                {currentPhoto && room.capture?.phase === 'review' && (
                  <section
                    ref={reviewPanel}
                    className="review-panel"
                    aria-label="Review captured photo"
                  >
                    <div className="review-image">
                      <Photo blob={currentPhoto} alt="Your captured photo" />
                    </div>
                    <div>
                      <span className="eyebrow">FRESH FROM THE BOOTH</span>
                      <h2>A keeper?</h2>
                      <p>Keep this moment, or give that pose another go.</p>
                      <div className="review-buttons">
                        <button
                          className="primary"
                          onClick={() =>
                            booth.send({ type: 'decide', id: room.capture!.id, keep: true })
                          }
                        >
                          <Heart size={17} />
                          Keep this one
                        </button>
                        <button
                          onClick={() =>
                            booth.send({ type: 'decide', id: room.capture!.id, keep: false })
                          }
                        >
                          Retake
                        </button>
                      </div>
                    </div>
                  </section>
                )}
                {settings && (
                  <section
                    id="booth-settings"
                    className="settings-panel"
                    aria-label="Booth settings"
                  >
                    <div className="tabs">
                      {(['scene', 'position', 'print'] as const).map((t) => (
                        <button
                          key={t}
                          className={tab === t ? 'active' : ''}
                          aria-pressed={tab === t}
                          onClick={() => setTab(t)}
                        >
                          {t === 'position'
                            ? 'Your position'
                            : t === 'print'
                              ? 'Print finish'
                              : 'Scene & effects'}
                        </button>
                      ))}
                    </div>
                    {tab === 'scene' && (
                      <>
                        <p className="small-note">
                          {director
                            ? 'You’re directing this shot.'
                            : `${room.members[room.director]?.name} is directing this shot.`}{' '}
                          You’ll swap after each keeper.
                        </p>
                        <fieldset disabled={!canEdit}>
                          <legend>Background</legend>
                          <div className="swatches">
                            {Object.entries(colors).map(([key, color]) => (
                              <button
                                key={key}
                                aria-label={`${key} background`}
                                aria-pressed={scene?.background === key}
                                style={{ background: color }}
                                onClick={() =>
                                  changeScene({ background: key as Scene['background'] })
                                }
                              >
                                {scene?.background === key && <Check size={17} />}
                              </button>
                            ))}
                          </div>
                          <div className="settings-row">
                            <label>
                              Arrangement
                              <select
                                aria-label="Arrangement"
                                value={scene?.layout}
                                onChange={(e) =>
                                  changeScene({ layout: e.target.value as Scene['layout'] })
                                }
                              >
                                <option value="together">Side by side</option>
                                <option value="overlap">A little closer</option>
                              </select>
                            </label>
                            <label>
                              Effect
                              <select
                                aria-label="Effect"
                                value={scene?.effect}
                                onChange={(e) =>
                                  changeScene({ effect: e.target.value as Scene['effect'] })
                                }
                              >
                                <option value="original">Original</option>
                                <option value="mono">Black & white</option>
                                <option value="warm">Warm film</option>
                              </select>
                            </label>
                          </div>
                        </fieldset>
                        <label className="check-row">
                          <input
                            type="checkbox"
                            checked={state.cutting}
                            disabled={!!room.capture}
                            onChange={(e) => booth.setCutting(e.target.checked)}
                          />
                          Remove backgrounds on this device
                        </label>
                      </>
                    )}
                    {tab === 'position' && (
                      <fieldset disabled={!!room.capture}>
                        <legend>Find your spot</legend>
                        {(['x', 'y', 'scale'] as const).map((key) => (
                          <label className="range-label" key={key}>
                            {key === 'x' ? 'Left / right' : key === 'y' ? 'Up / down' : 'Size'}
                            <input
                              aria-label={
                                key === 'x'
                                  ? 'Horizontal position'
                                  : key === 'y'
                                    ? 'Vertical position'
                                    : 'Person size'
                              }
                              type="range"
                              min={key === 'scale' ? 0.6 : -0.4}
                              max={key === 'scale' ? 1.5 : 0.4}
                              step=".02"
                              value={room.positions[state.seat][key]}
                              onChange={(e) =>
                                booth.send({
                                  type: 'position',
                                  position: {
                                    ...room.positions[state.seat],
                                    [key]: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {tab === 'print' && (
                      <fieldset disabled={!canEdit}>
                        <legend>Your keepsake</legend>
                        <div className="settings-row">
                          <label>
                            Border
                            <select
                              aria-label="Border"
                              value={scene?.border}
                              onChange={(e) =>
                                changeScene({ border: e.target.value as Scene['border'] })
                              }
                            >
                              <option value="ivory">Classic ivory</option>
                              <option value="cherry">Cherry red</option>
                            </select>
                          </label>
                          <label>
                            Finish
                            <select
                              aria-label="Finish"
                              value={scene?.finish}
                              onChange={(e) =>
                                changeScene({ finish: e.target.value as Scene['finish'] })
                              }
                            >
                              <option value="clean">Clean print</option>
                              <option value="paper">Paper grain</option>
                              <option value="dated">Date stamp</option>
                            </select>
                          </label>
                        </div>
                      </fieldset>
                    )}
                  </section>
                )}
              </>
            ) : (
              <div className="stage-caption">
                <span>REAL MOMENTS, SHARED FROM ANYWHERE</span>
                <Heart size={15} />
                <span>MADE FOR TWO</span>
              </div>
            )}
          </section>
          <aside className="reference-column">
            {!room ? (
              <section className="join-panel">
                <span className="eyebrow">YOUR PRIVATE PHOTO BOOTH</span>
                <h2>{inviteRoom ? 'Your person is waiting.' : 'Save them a seat.'}</h2>
                <p>
                  {inviteRoom
                    ? 'Give yourself a name and knock on the booth door.'
                    : 'Open a booth, send your person the link, and make a little memory.'}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    booth.open(
                      inviteRoom && inviteToken
                        ? { type: 'join', room: inviteRoom, invite: inviteToken, name }
                        : { type: 'create', name },
                    );
                  }}
                >
                  <label htmlFor="name">What should we call you?</label>
                  <input
                    id="name"
                    autoComplete="given-name"
                    maxLength={24}
                    required
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={!name.trim() || state.waiting}
                    type="submit"
                  >
                    {state.waiting
                      ? 'Waiting to be let in…'
                      : inviteRoom
                        ? 'Join the booth'
                        : 'Open our booth'}
                    <ArrowRight size={18} />
                  </button>
                </form>
                <div className="privacy-note">
                  <LockKeyhole size={17} />
                  <p>No account. No recordings. Camera starts only when you turn it on.</p>
                </div>
                <p className="small-note">
                  Your partner receives your original live video. Background removal changes the
                  photo, not what they can receive.
                </p>
                <div className="sample-strip" aria-label="Example pose references">
                  <PoseImage index={0} />
                  <PoseImage index={1} />
                  <PoseImage index={6} />
                </div>
              </section>
            ) : (
              <>
                {state.seat === 0 && !room.members[1] && (
                  <section className="invite-panel">
                    <span className="eyebrow">SAVE A SEAT</span>
                    <h3>Bring your person.</h3>
                    <button
                      className="primary"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(invite)
                          .then(() => {
                            setInviteCopied(true);
                            if (copyTimer.current) clearTimeout(copyTimer.current);
                            copyTimer.current = setTimeout(() => setInviteCopied(false), 4000);
                          })
                          .catch(() => booth.notify('Copy the invitation from the field below.'))
                      }
                    >
                      {inviteCopied ? <Check size={16} /> : <Copy size={16} />}
                      {inviteCopied ? 'Invitation copied!' : 'Copy invitation'}
                    </button>
                    <p className="invite-help" role="status">
                      {inviteCopied
                        ? 'Send the link to your person. You’ll let them in when they arrive.'
                        : 'Only share this link with your person. You’ll approve them at the door.'}
                    </p>
                    <input
                      aria-label="Private invitation link"
                      value={invite}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                  </section>
                )}
                {room.pending && state.seat === 0 && (
                  <section className="admission" role="status">
                    <h3>{room.pending.name} is at the door.</h3>
                    <div>
                      <button
                        className="primary"
                        onClick={() =>
                          booth.send({ type: 'admit', id: room.pending!.id, accept: true })
                        }
                      >
                        Let them in
                      </button>
                      <button
                        onClick={() =>
                          booth.send({ type: 'admit', id: room.pending!.id, accept: false })
                        }
                      >
                        Decline
                      </button>
                    </div>
                  </section>
                )}
                <PoseSheet open={referenceOpen} close={() => setReferenceOpen(false)}>
                  <section className="reference-panel" id="pose-references">
                    <div className="panel-heading">
                      <span className="eyebrow">A LITTLE INSPIRATION</span>
                      <button
                        className="icon-button mobile-close"
                        aria-label="Close references"
                        onClick={() => setReferenceOpen(false)}
                      >
                        <X size={18} />
                      </button>
                      <button
                        className={`icon-button favorite ${favorites.includes(reference) ? 'favorited' : ''}`}
                        aria-label="Favorite this pose"
                        aria-pressed={favorites.includes(reference)}
                        onClick={favorite}
                      >
                        <Heart size={19} />
                      </button>
                    </div>
                    <h2 id="pose-title">Strike a pose.</h2>
                    <div className="reference-print">
                      <PoseImage index={reference} />
                      <span className="reference-number">
                        NO. {String(reference + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="pose-heading">
                      <h3>{references[reference].title}</h3>
                      <span>{references[reference].category}</span>
                    </div>
                    <p className="pose-prompt">{references[reference].prompt}</p>
                    {references[reference].memeSource && (
                      <a
                        className="meme-source"
                        href={references[reference].memeSource}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open original meme ↗
                      </a>
                    )}
                    <div className="pose-navigation">
                      <button
                        aria-label="Previous pose"
                        disabled={!canEdit}
                        onClick={() => step(-1)}
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button className="roulette" disabled={!canEdit} onClick={roulette}>
                        <Shuffle size={16} />
                        Surprise us
                      </button>
                      <button aria-label="Next pose" disabled={!canEdit} onClick={() => step(1)}>
                        <ChevronRight size={18} />
                      </button>
                    </div>
                    <div className="pose-filters" aria-label="Browse poses">
                      {[
                        ['All poses', 'All'],
                        ['Meme recreations', 'Memes'],
                        ['Favorites', 'Favorites'],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          aria-pressed={category === value}
                          onClick={() => setCategory(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <select
                      aria-label="Pose category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      {[
                        'All poses',
                        'Favorites',
                        'Couple',
                        'Cute',
                        'Reaction',
                        'Cinematic',
                        'Funny',
                        'Chaotic',
                        'Meme recreations',
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <div className="pose-thumbnails">
                      {visibleReferences.map((r) => (
                        <button
                          key={r.index}
                          aria-label={`Choose ${r.title}`}
                          title={r.title}
                          disabled={!canEdit}
                          aria-pressed={reference === r.index}
                          onClick={() => choose(r.index)}
                        >
                          <PoseImage index={r.index} />
                        </button>
                      ))}
                    </div>
                    {!visibleReferences.length && (
                      <p className="small-note">Tap the heart on a pose to keep it here.</p>
                    )}
                    <div className="director-note">
                      <Sparkles size={15} />
                      <span>
                        {director
                          ? 'Your turn to direct'
                          : `${room.members[room.director]?.name} is directing`}
                      </span>
                    </div>
                    <p className="small-note">
                      References are inspiration only. They won’t appear in your photos.
                    </p>
                  </section>
                </PoseSheet>
              </>
            )}
          </aside>
        </div>
        {room && (
          <>
            <button
              className="mobile-reference-toggle"
              aria-expanded={referenceOpen}
              aria-haspopup="dialog"
              aria-controls="pose-references"
              onClick={() => setReferenceOpen(!referenceOpen)}
            >
              <PoseImage index={reference} />
              <span>
                {references[reference].title}
                <small>Open pose references</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <section className="gallery" aria-label="Session gallery">
              <div className="gallery-heading">
                <div>
                  <span className="eyebrow">LITTLE MOMENTS, ALL YOURS</span>
                  <h2>
                    Your photo strip <span>{selection.length}/4</span>
                  </h2>
                </div>
                <button
                  className="primary"
                  disabled={
                    selection.length !== 4 ||
                    saving ||
                    selection.some((id) => !state.photos.has(id))
                  }
                  onClick={() => void saveStrip()}
                >
                  <Download size={17} />
                  {saving ? 'Preparing…' : 'Save photo strip'}
                </button>
              </div>
              <div className={`film-rail ${scene?.border === 'cherry' ? 'cherry' : ''}`}>
                {Array.from({ length: Math.max(4, room.shots.length) }, (_, i) => {
                  const shot = room.shots[i],
                    blob = shot && state.photos.get(shot.id);
                  return (
                    <div className="film-cell" key={shot?.id || i}>
                      {shot && blob ? (
                        <>
                          <button
                            className="photo-button"
                            onClick={() => setSelectedShot(shot.id)}
                            aria-label={`Decorate photo ${i + 1}`}
                          >
                            <Photo
                              blob={blob}
                              decorations={shot.decorations}
                              alt={`Photo ${i + 1}`}
                            />
                            <span>
                              Add your touch <Plus size={14} />
                            </span>
                          </button>
                          <label className="strip-choice">
                            <input
                              type="checkbox"
                              checked={selection.includes(shot.id)}
                              disabled={!selection.includes(shot.id) && selection.length === 4}
                              onChange={(e) =>
                                setSelection((prev) =>
                                  e.target.checked
                                    ? prev.length < 4
                                      ? [...prev, shot.id]
                                      : prev
                                    : prev.filter((id) => id !== shot.id),
                                )
                              }
                            />
                            In your strip
                          </label>
                        </>
                      ) : (
                        <div className="empty-photo">
                          <span>{String(i + 1).padStart(2, '0')}</span>
                          <p>
                            {shot
                              ? 'Receiving photo…'
                              : i === 0
                                ? 'Your first memory'
                                : 'A moment to come'}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="small-note" role="status">
                {selection.length < 4
                  ? `Choose ${4 - selection.length} more ${selection.length === 3 ? 'photo' : 'photos'} to complete your strip.`
                  : 'Your strip is ready to save. Uncheck a photo to swap in another.'}{' '}
                Tap a photo to decorate or save it individually. Download before leaving or
                refreshing.
              </p>
            </section>
            {!state.relayConfigured && (
              <p className="connection-footnote">
                A relay service is not configured yet. Your cameras may not connect across some
                networks.
              </p>
            )}
          </>
        )}
      </main>
      <footer>
        <span>KD Photo Booth</span>
        <span>Different places. Same little moment.</span>
        <Heart size={13} />
      </footer>
      {selected && state.photos.get(selected.id) && (
        <Decorate
          booth={booth}
          shot={selected}
          blob={state.photos.get(selected.id)!}
          close={() => setSelectedShot(null)}
        />
      )}
      {leaveOpen && (
        <dialog
          ref={leaveDialog}
          className="leave-dialog"
          aria-labelledby="leave-title"
          onCancel={() => setLeaveOpen(false)}
        >
          <h2 id="leave-title">Close the curtain?</h2>
          <p>
            Leaving closes the booth for both of you. Save your photos first; this session won’t be
            stored.
          </p>
          <div>
            <button
              onClick={() => {
                setLeaveOpen(false);
              }}
            >
              Stay here
            </button>
            <button
              className="primary"
              onClick={() => {
                booth.leave();
                setLeaveOpen(false);
              }}
            >
              Leave booth
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
