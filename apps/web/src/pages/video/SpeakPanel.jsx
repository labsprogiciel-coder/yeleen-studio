import { useState } from 'react'
import Icon from '../../lib/icons.jsx'
import Menu from '../../components/Menu.jsx'
import MentionTextarea from '../../components/MentionTextarea.jsx'
import Segmented from '../../components/Segmented.jsx'
import { Section, DropTile, GenerateButton } from '../../components/GenPanel.jsx'

const SOURCES = [{ id: 'script', title: 'Script' }, { id: 'audio', title: 'Ajouter un audio' }]
const VOICES = [{ id: 'voix-1', title: 'Voix 1' }, { id: 'voix-2', title: 'Voix 2' }] // TODO: real voices

export default function SpeakPanel({ cost = 0, onGenerate, onPreview }) {
  const [files, setFiles] = useState({})
  const [source, setSource] = useState('script')
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('')
  const setFile = (k) => (f) => setFiles((o) => ({ ...o, [k]: f }))

  const blocker = !(files.start || files.video) ? 'Ajoutez une image ou une vidéo.'
    : source === 'script' && !text.trim() ? 'Écrivez ce que dit le personnage.'
    : source === 'script' && !voice ? 'Choisissez une voix.'
    : source === 'audio' && !files.audio ? 'Ajoutez un fichier audio.'
    : null

  return (
    <div className="ep">
      <Section id="sp-custom" title="Personnaliser">
        <div className="ep-tiles">
          <DropTile icon="user" label="Image de départ" accept="image/*" file={files.start ?? null} onFile={setFile('start')} disabled={Boolean(files.video)} reason="Retirez la vidéo pour utiliser une image" />
          <DropTile icon="vid" label="Vidéo" accept="video/*" file={files.video ?? null} onFile={setFile('video')} disabled={Boolean(files.start)} reason="Retirez l’image pour utiliser une vidéo" />
        </div>
      </Section>

      <Segmented items={SOURCES} value={source} onChange={setSource} label="Source de la voix" />

      {source === 'script' ? (
        <>
          <div className="ep-prompt">
            <MentionTextarea mentions={false} value={text} onChange={setText} placeholder="Écrivez ce que dit le personnage" aria-label="Script" rows={5} data-prompt />
            <div className="ep-pfoot">
              <Menu items={VOICES} value={voice} onChange={setVoice} label="Voix" menuWidth={260} className="ep-chip">
                <Icon name="mic" size={16} />{VOICES.find((v) => v.id === voice)?.title ?? 'Choisir une voix'}
              </Menu>
              <button type="button" className="ep-clear" aria-label="Effacer le script" disabled={!text} onClick={() => setText('')}><Icon name="close" size={14} /></button>
            </div>
          </div>
          <button type="button" className="ep-chip ep-wide" disabled={!text.trim() || !voice} onClick={() => onPreview?.({ text, voice })}>
            <Icon name="wave" size={16} />Écouter la voix
          </button>
        </>
      ) : (
        <DropTile icon="mus" label="Fichier audio" accept="audio/*" file={files.audio ?? null} onFile={setFile('audio')} required />
      )}

      <GenerateButton price={cost} disabled={Boolean(blocker)} title={blocker ?? undefined} onClick={() => onGenerate?.({ files, source, text, voice })} />
    </div>
  )
}
