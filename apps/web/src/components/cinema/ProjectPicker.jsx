import Icon from '../../lib/icons.jsx'
import Menu from '../Menu.jsx'
import { createProject, selectProject, useProjects } from '../../lib/projects.js'

/** Projet ouvert, et le menu pour en changer ou en créer un : Créations ne montre que les générations du projet. */
export default function ProjectPicker() {
  const { list, current, project } = useProjects()
  const items = [
    ...list.map((p) => ({ id: p.id, title: p.name, icon: 'folder' })),
    { id: '__new', title: 'Nouveau projet', icon: 'plus' },
  ]
  return (
    <Menu items={items} value={current} onChange={(id) => (id === '__new' ? createProject() : selectProject(id))} label={`Projet : ${project.name}`} menuWidth={260} className="cx-proj" listClass="cn-pop">
      <i className="cx-proj-dot" style={{ background: project.color }} aria-hidden="true" />
      <span>{project.name}</span>
      <span className="cx-proj-ud" aria-hidden="true"><Icon name="updown" size={16} /></span>
    </Menu>
  )
}
