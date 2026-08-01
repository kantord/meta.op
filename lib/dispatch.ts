// lib/dispatch.ts — runs a task's prompt for real, using `pi` inside an isolated podman
// container (docker/pi-agent.Containerfile) so the dispatched agent never touches the host
// directly. Build the image once with:
//   podman build -t pi-agent -f docker/pi-agent.Containerfile docker
import { read, sh } from 'esto'

const IMAGE = 'pi-agent'
const PROVIDER = 'openrouter'
const MODEL = 'moonshotai/kimi-k2.6'
const PI_AUTH_FILE = '/home/kantord/.pi/agent/auth.json'

export const dispatchTask = (owner: string, repo: string, taskFile: string): void => {
  const task = read(taskFile)
  const authorName = sh`git config --global user.name`.trim()
  const authorEmail = sh`git config --global user.email`.trim()
  const ghToken = sh`gh auth token`.trim()
  const openrouterKey = sh`python3 -c "import json; print(json.load(open(${PI_AUTH_FILE}))['openrouter']['key'])"`.trim()

  // Built as one plain string so $TASK/$OPENROUTER_KEY stay literal here and get
  // safely quoted as a single argument by esto's sh tag below — the container's
  // own shell resolves them at runtime, not esto's.
  const innerScript = `git clone https://github.com/${owner}/${repo} repo && cd repo && pi -p "$TASK" --provider ${PROVIDER} --model ${MODEL} --api-key "$OPENROUTER_KEY"`

  sh`podman run --rm \
    -e GH_TOKEN=${ghToken} \
    -e GIT_AUTHOR_NAME=${authorName} -e GIT_AUTHOR_EMAIL=${authorEmail} \
    -e GIT_COMMITTER_NAME=${authorName} -e GIT_COMMITTER_EMAIL=${authorEmail} \
    -e TASK=${task} \
    -e OPENROUTER_KEY=${openrouterKey} \
    ${IMAGE} \
    sh -c ${innerScript}`
}
