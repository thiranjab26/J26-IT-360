// Demo and debug page for the load sensor. The consent screen, landmark
// overlay and live feature charts are added in TODO A3–A6.

const app = document.querySelector<HTMLElement>('#app');

if (app) {
  const heading = document.createElement('h1');
  heading.textContent = 'AdaptLearn C02 — Load sensor';

  const status = document.createElement('p');
  status.dataset['testid'] = 'sensor-status';
  status.textContent = 'Sensing is off.';

  app.append(heading, status);
}
