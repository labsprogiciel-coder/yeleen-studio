import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../lib/icons.jsx'
import Menu from '../../components/Menu.jsx'
import MentionTextarea from '../../components/MentionTextarea.jsx'
import Segmented from '../../components/Segmented.jsx'
import { Section, DropTile, GenerateButton } from '../../components/GenPanel.jsx'
import { AUDIO_MODELS, findModel, priceLabel, voiceCost } from '@studio/catalog'
import { VOICES, findVoice } from '@studio/catalog/voices'
import { synthWav } from '../../lib/media.js'
import { useBrand } from '../../lib/brand.jsx'
import { jetons, useJobs } from '../../lib/jobs.jsx'
import { modelItem } from '../../lib/modelItem.js'
import { logoFor } from '../../lib/modelLogos.js'
import ModelLogo from '../../components/ModelLogo.jsx'
import Flag from '../../components/Flag.jsx'
import { flagFor } from '../../lib/flags.js'
import { TOOLS } from '../../components/cinema/tools.js'

const LANGUAGES = [
  { id: 'auto', title: 'Détection auto' },
  { id: 'fr', title: 'Français' },
  { id: 'en', title: 'Anglais' },
  { id: 'es', title: 'Espagnol' },
  { id: 'pt', title: 'Portugais' },
  { id: 'de', title: 'Allemand' },
  { id: 'ar', title: 'Arabe' },
]

const NORMALIZATION = [
  { id: 'auto', title: 'Automatique' },
  { id: 'on', title: 'Épeler nombres & sigles' },
  { id: 'off', title: 'Texte brut' },
]

const ISOLATION_MODES = [
  { id: 'vocal', title: 'Isoler la voix' },
  { id: 'denoise', title: 'Supprimer le bruit' },
  { id: 'split', title: 'Séparer les pistes' },
]

export default function AudioPanel({ tool = 'voice-generator', onTool }) {
  const currentTool = tool || 'voice-generator'
  const tInfo = TOOLS.audio.find((x) => x.id === currentTool) ?? TOOLS.audio[0]

  const { brand } = useBrand()
  const { submit } = useJobs()
  const [error, setError] = useState('')

  // Voix & échantillon
  const [voiceId, setVoiceId] = useState(() => findVoice(brand?.voice).id)
  const voice = findVoice(voiceId)
  const voiceIdx = VOICES.findIndex((v) => v.id === voiceId)
  const [previewing, setPreviewing] = useState(false)
  const sample = useRef(null)

  const stopSample = () => {
    if (sample.current) {
      sample.current.pause()
      URL.revokeObjectURL(sample.current.src)
      sample.current = null
    }
    setPreviewing(false)
  }

  const togglePreview = () => {
    if (previewing) return stopSample()
    const el = new window.Audio(URL.createObjectURL(new Blob([synthWav(voiceIdx * 3 + 1, 3)], { type: 'audio/wav' })))
    el.onended = stopSample
    sample.current = el
    el.play().then(() => setPreviewing(true)).catch(stopSample)
  }

  useEffect(() => stopSample, [voiceId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopSample(), [])

  const pickVoice = (id) => {
    stopSample()
    setVoiceId(id)
  }

  // Modèle TTS
  const [modelId, setModelId] = useState(AUDIO_MODELS[0].id)
  const model = findModel(AUDIO_MODELS, modelId)
  const has = (p) => model.caps.params.includes(p)

  // Options TTS
  const [script, setScript] = useState('')
  const [prompt, setPrompt] = useState('')
  const [language, setLanguage] = useState(() => (LANGUAGES.some((l) => l.id === brand?.lang) ? brand.lang : 'auto'))
  const [normalization, setNormalization] = useState('auto')
  const [timestamps, setTimestamps] = useState(false)
  const [count, setCount] = useState(1)

  // Audio d'entrée / référence
  const [file, setFile] = useState(null)
  const [duration, setDuration] = useState(10)
  const [isolationMode, setIsolationMode] = useState('vocal')

  const toolItems = useMemo(() => TOOLS.audio.map((x) => ({
    id: x.id,
    icon: x.icon,
    title: x.title,
    desc: x.desc,
  })), [])

  const modelItems = useMemo(() => AUDIO_MODELS.map((m) => modelItem(m, 'audio')), [])

  const voiceItems = useMemo(() => VOICES.map((v) => ({
    id: v.id,
    title: v.label,
    desc: `${v.gender === 'f' ? 'Voix féminine' : 'Voix masculine'}${flagFor(v.country) ? ` · ${flagFor(v.country).accent}` : ''} · ${v.trait}`,
  })), [])

  // Coût
  const isTTS = currentTool === 'voice-generator'
  const isChanger = currentTool === 'voice-changer'
  const isIsolation = currentTool === 'audio-isolation'
  const isGen = currentTool === 'music-generator' || currentTool === 'audio-generator' || currentTool === 'sound-effect-generator'

  const ttsCost = Math.round(voiceCost(model, script.length) * count * 10) / 10
  const genericCost = isIsolation ? 4 : isChanger ? 5 : Math.round(duration * 0.5 * 10) / 10
  const price = isTTS ? ttsCost : genericCost

  // Bloqueur
  const blocker = isTTS && !script.trim() ? 'Écrivez le texte que la voix off doit lire.'
    : isChanger && !file ? 'Ajoutez un fichier audio à transformer.'
    : isIsolation && !file ? 'Ajoutez un fichier audio à traiter.'
    : isGen && !prompt.trim() ? 'Décrivez ce que vous souhaitez générer.'
    : null

  const handleGenerate = () => {
    setError('')
    if (isTTS) {
      const lang = LANGUAGES.find((l) => l.id === language)
      const live = { kind: 'audio', modelId: model.id, prompt: script.trim(), voice: voice.id, language, normalization, timestamps }
      const r = submit({
        kind: 'audio',
        title: model.name,
        prompt: script.trim(),
        count,
        cost: price,
        live,
        secs: Math.max(1, Math.round(script.length / 14)),
        voice: voice.id,
        meta: `${voice.label} · ${script.length} caractères${language === 'auto' ? '' : ` · ${lang?.title ?? language}`}`,
      })
      if (!r.ok) setError(`Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
    } else if (isGen) {
      const live = { kind: 'audio', tool: currentTool, prompt: prompt.trim(), secs: duration, file }
      const r = submit({
        kind: 'audio',
        title: tInfo.title,
        prompt: prompt.trim(),
        count: 1,
        cost: price,
        live,
        secs: duration,
        meta: `${tInfo.title} · ${duration} s`,
      })
      if (!r.ok) setError(`Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
    } else {
      const live = { kind: 'audio', tool: currentTool, file, voice: isChanger ? voice.id : undefined, mode: isIsolation ? isolationMode : undefined }
      const r = submit({
        kind: 'audio',
        title: tInfo.title,
        prompt: isChanger ? `Transformer avec la voix ${voice.label}` : `Isolation : ${ISOLATION_MODES.find((m) => m.id === isolationMode)?.title}`,
        count: 1,
        cost: price,
        live,
        secs: 10,
        meta: isChanger ? `Voix ${voice.label}` : ISOLATION_MODES.find((m) => m.id === isolationMode)?.title,
      })
      if (!r.ok) setError(`Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
    }
  }

  return (
    <div className="ep">
      <Section id="ap-tool" title="Outil audio">
        <Menu items={toolItems} value={currentTool} onChange={onTool ?? (() => {})} label="Outil audio" menuWidth={320}>
          <Icon name={tInfo.icon} size={18} /><span className="ep-ell">{tInfo.title}</span>
        </Menu>
      </Section>

      {isTTS && (
        <>
          <Section id="ap-model" title="Modèle">
            <Menu items={modelItems} value={modelId} onChange={setModelId} label="Modèle audio" menuWidth={420} search="Rechercher un modèle…">
              <ModelLogo logo={logoFor(model.id)} size={18} />
              <span className="ep-ell">{model.name}</span>
              <span className="ep-price">{priceLabel(model)}</span>
            </Menu>
          </Section>

          <Section id="ap-voice" title="Voix">
            <div className="ep-row">
              <Menu items={voiceItems} value={voiceId} onChange={pickVoice} label="Voix" menuWidth={300} className="ep-chip ep-ell">
                <Flag country={voice.country} size={18} />
                <span className="ep-ell">{voice.label} ({voice.gender === 'f' ? 'Femme' : 'Homme'})</span>
              </Menu>
              <button
                type="button"
                className="ep-chip"
                onClick={togglePreview}
                aria-pressed={previewing}
                title={previewing ? 'Arrêter l’écoute' : 'Écouter un extrait de cette voix'}
              >
                <Icon name={previewing ? 'pause' : 'play'} size={15} />
                {previewing ? 'Stop' : 'Écouter'}
              </button>
            </div>
          </Section>

          <Section id="ap-script" title="Texte à lire">
            <div className="ep-prompt">
              <MentionTextarea
                mentions={false}
                value={script}
                onChange={setScript}
                placeholder="Écrivez le texte exact que la voix off doit lire à voix haute…"
                aria-label="Script audio"
                rows={5}
                data-prompt
              />
              <div className="ep-pfoot">
                {has('language') && (
                  <Menu items={LANGUAGES} value={language} onChange={setLanguage} label="Langue" menuWidth={220} className="ep-chip">
                    <Icon name="globe" size={15} />
                    {LANGUAGES.find((l) => l.id === language)?.title ?? 'Langue'}
                  </Menu>
                )}
                <button
                  type="button"
                  className="ep-clear"
                  aria-label="Effacer le texte"
                  disabled={!script}
                  onClick={() => setScript('')}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          </Section>

          <div className="ep-opts">
            <button
              type="button"
              className="ep-chip"
              title="Nombre de versions générées"
              onClick={() => setCount((c) => (c % 3) + 1)}
            >
              <Icon name="layers" size={15} />
              {count} {count > 1 ? 'versions' : 'version'}
            </button>
            {has('normalization') && (
              <Menu items={NORMALIZATION} value={normalization} onChange={setNormalization} label="Normalisation" menuWidth={260} className="ep-chip">
                <Icon name="gauge" size={15} />
                {NORMALIZATION.find((n) => n.id === normalization)?.title}
              </Menu>
            )}
            {has('timestamps') && (
              <button
                type="button"
                className="ep-chip"
                aria-pressed={timestamps}
                onClick={() => setTimestamps((v) => !v)}
                title="Générer un horodatage mot à mot pour sous-titres"
              >
                <Icon name="clock" size={15} />
                {timestamps ? 'Sous-titres ON' : 'Sous-titres'}
              </button>
            )}
          </div>
        </>
      )}

      {isGen && (
        <>
          <Section id="ap-prompt" title="Description sonore">
            <div className="ep-prompt">
              <MentionTextarea
                mentions={false}
                value={prompt}
                onChange={setPrompt}
                placeholder={
                  currentTool === 'music-generator'
                    ? 'Décrivez la musique : ambiance, tempo, instruments (ex. afrobeat entraînant, percussions rythmées et cuivres festifs)…'
                    : currentTool === 'sound-effect-generator'
                      ? 'Décrivez l’effet sonore (ex. porte métallique qui grince, pluie battante, pas sur le gravier)…'
                      : 'Décrivez l’ambiance audio souhaitée…'
                }
                aria-label="Description"
                rows={4}
                data-prompt
              />
              <div className="ep-pfoot">
                <button
                  type="button"
                  className="ep-clear"
                  aria-label="Effacer"
                  disabled={!prompt}
                  onClick={() => setPrompt('')}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          </Section>

          <Section id="ap-ref" title="Inspiration (facultatif)">
            <div className="ep-tiles one">
              <DropTile icon="mus" label="Audio d’inspiration" accept="audio/*" file={file} onFile={setFile} />
            </div>
          </Section>

          <div className="ep-opts three">
            <button
              type="button"
              className="ep-chip"
              title="Durée de l’audio"
              onClick={() => setDuration((d) => (d === 5 ? 10 : d === 10 ? 15 : d === 15 ? 30 : 5))}
            >
              <Icon name="clock" size={15} />
              {duration} s
            </button>
            <button type="button" className="ep-chip" disabled title="Qualité audio : 48 kHz stéréo">
              <Icon name="upscale" size={15} />
              48 kHz
            </button>
            <button type="button" className="ep-chip" disabled title="Format audio standard">
              <Icon name="audio" size={15} />
              WAV
            </button>
          </div>
        </>
      )}

      {isChanger && (
        <>
          <Section id="ap-source" title="Fichier audio d’origine">
            <div className="ep-tiles one">
              <DropTile icon="mus" label="Audio à transformer" accept="audio/*" file={file} onFile={setFile} required />
            </div>
          </Section>

          <Section id="ap-voice" title="Voix de transformation">
            <div className="ep-row">
              <Menu items={voiceItems} value={voiceId} onChange={pickVoice} label="Voix cible" menuWidth={300} className="ep-chip ep-ell">
                <Flag country={voice.country} size={18} />
                <span className="ep-ell">{voice.label} ({voice.gender === 'f' ? 'Femme' : 'Homme'})</span>
              </Menu>
              <button
                type="button"
                className="ep-chip"
                onClick={togglePreview}
                aria-pressed={previewing}
                title="Écouter un extrait de la voix cible"
              >
                <Icon name={previewing ? 'pause' : 'play'} size={15} />
                {previewing ? 'Stop' : 'Écouter'}
              </button>
            </div>
          </Section>
        </>
      )}

      {isIsolation && (
        <>
          <Section id="ap-source" title="Fichier audio à traiter">
            <div className="ep-tiles one">
              <DropTile icon="mus" label="Fichier avec voix et bruit" accept="audio/*" file={file} onFile={setFile} required />
            </div>
          </Section>

          <Section id="ap-mode" title="Traitement souhaité">
            <Segmented
              items={ISOLATION_MODES}
              value={isolationMode}
              onChange={setIsolationMode}
              label="Mode de traitement"
            />
          </Section>
        </>
      )}

      <GenerateButton
        price={price}
        disabled={Boolean(blocker)}
        error={error}
        title={blocker ?? undefined}
        onClick={handleGenerate}
      />
    </div>
  )
}
