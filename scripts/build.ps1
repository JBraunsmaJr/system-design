param(
    [Parameter(Mandatory=$true)]
    [string]$DockerTag,

    [bool]$push = $false
)

$scriptPath = $PSScriptRoot
$serverPath = Join-Path "$scriptPath" -ChildPath ".."
$relayPath = Join-Path "$scriptPath" -ChildPath "../docker/signaling"


$designName = "ghcr.io/jbraunsmajr/system-design"
$relayName = "ghcr.io/jbraunsmajr/system-design-relay"

$designTag = "{0}:{1}" -f $designName, $DockerTag
$designLatestTag = "{0}:latest" -f $designName

$relayTag = "{0}:{1}" -f $relayName, $DockerTag
$relayLatestTag = "{0}:latest" -f $relayName

docker build -t "$designTag" "$serverPath"
docker tag "$designTag" "$designLatestTag"

docker build -t "$relayTag" "$relayPath"
docker tag "$relayTag" "$relayLatestTag"

if ($push) {
    docker push "$relayTag"
    docker push "$relayLatestTag"

    docker push "$designLatestTag"
    docker push "$designTag"
}