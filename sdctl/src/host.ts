import { existsSync, accessSync, constants } from 'fs';

export interface HostCheckResult {
  ok: boolean;
  message?: string;
  suggestedFix?: string;
}

export function checkDockerSocket(customPath?: string): HostCheckResult {
  const defaultSocketPaths = [
    customPath,
    process.env.DOCKER_HOST?.replace(/^unix:\/\//, ''),
    '/var/run/docker.sock',
    '/run/docker.sock',
    '/run/user/1000/podman/podman.sock',
  ].filter(Boolean) as string[];

  // On Windows dev environments without Docker container, skip or report informative message
  if (process.platform === 'win32' && !process.env.CONTAINER_ENV) {
    return {
      ok: true,
      message: 'Running in Windows development mode.',
    };
  }

  for (const socketPath of defaultSocketPaths) {
    if (existsSync(socketPath)) {
      try {
        accessSync(socketPath, constants.R_OK | constants.W_OK);
        return { ok: true };
      } catch {
        return {
          ok: false,
          message: `Docker socket found at ${socketPath} but current user lacks read/write permissions.`,
          suggestedFix: 'Run the container with appropriate permissions or user group: `docker run --group-add ...`',
        };
      }
    }
  }

  return {
    ok: false,
    message: 'Docker socket was not found or is not mounted inside the container.',
    suggestedFix:
      'Mount the Docker socket into the container when running sdctl:\n' +
      '  docker run -it --rm -v /var/run/docker.sock:/var/run/docker.sock ...',
  };
}

export function checkMountPathParity(workingDir: string = process.cwd()): HostCheckResult {
  // If running inside container (indicated by env or container indicator)
  const hostPwd = process.env.SDCTL_HOST_PWD;
  if (hostPwd && hostPwd !== workingDir) {
    return {
      ok: false,
      message: `Working directory mismatch: inside container is "${workingDir}" but host directory is "${hostPwd}".`,
      suggestedFix:
        'Bind-mount paths are resolved by the host Docker daemon. Ensure the working directory is mounted at the same absolute path inside and outside:\n' +
        `  docker run -it --rm -v "${hostPwd}:${hostPwd}" -w "${hostPwd}" ...`,
    };
  }

  return { ok: true };
}
