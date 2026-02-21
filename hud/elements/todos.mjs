import { cyan, green, dim, yellow } from '../colors.mjs';

export function renderTodos(todos) {
  if (!todos || todos.length === 0) return null;

  const completed = todos.filter(t => t.status === 'completed').length;
  const inProgress = todos.find(t => t.status === 'in_progress');
  const total = todos.length;

  let text = `todos:${green(String(completed))}/${cyan(String(total))}`;

  if (inProgress) {
    const activeForm = inProgress.activeForm || inProgress.content || '';
    const truncated = activeForm.length > 40 ? activeForm.slice(0, 37) + '...' : activeForm;
    text += ` ${dim('(')}${yellow(truncated)}${dim(')')}`;
  }

  return text;
}
