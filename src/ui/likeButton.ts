/**
 * The thumbs-up toggle for a shared course, used on the preview and results
 * screens. Pure DOM; the App sends the like and calls `update` with the count.
 */

export interface LikeView {
  liked: boolean;
  /** null while the count isn't known yet. */
  likes: number | null;
  /** A like is on its way to the server. */
  busy: boolean;
}

export interface LikeButton {
  readonly element: HTMLButtonElement;
  update(view: LikeView): void;
}

export function likeButton(onToggle: () => void): LikeButton {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'like-btn';
  const icon = document.createElement('span');
  icon.className = 'like-btn__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '👍';
  const label = document.createElement('span');
  label.className = 'like-btn__label';
  const count = document.createElement('span');
  count.className = 'like-btn__count';
  element.append(icon, label, count);
  element.addEventListener('click', () => {
    element.blur();
    onToggle();
  });
  return {
    element,
    update(view) {
      element.setAttribute('aria-pressed', String(view.liked));
      element.disabled = view.busy;
      label.textContent = view.liked ? 'Liked' : 'Like';
      count.textContent = view.likes === null ? '' : String(view.likes);
      count.hidden = view.likes === null;
      element.title = view.liked ? 'You like this course (click to take it back)' : 'Like this course: liked courses rise to Popular on the home screen';
      const total = view.likes === null ? '' : `: ${view.likes} ${view.likes === 1 ? 'like' : 'likes'}`;
      element.setAttribute('aria-label', `${view.liked ? 'Liked' : 'Like'}${total}`);
    },
  };
}
