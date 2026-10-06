$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskMethods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
}

function Await-WinRT($operation, $resultType) {
  $method = $asTaskMethods[0].MakeGenericMethod($resultType)
  $task = $method.Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$manager = Await-WinRT ($managerType::RequestAsync()) $managerType
$sessions = @($manager.GetSessions())
$session = $sessions | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq "Playing" } | Select-Object -First 1
if ($null -eq $session) { $session = $manager.GetCurrentSession() }
if ($null -eq $session) { exit 0 }

$media = Await-WinRT ($session.TryGetMediaPropertiesAsync()) $propertiesType
$timeline = $session.GetTimelineProperties()
$status = $session.GetPlaybackInfo().PlaybackStatus.ToString()

[ordered]@{
  player = $session.SourceAppUserModelId
  title = $media.Title
  artist = $media.Artist
  album = $media.AlbumTitle
  duration = $timeline.EndTime.TotalSeconds
  position = $timeline.Position.TotalSeconds
  playing = ($status -eq "Playing")
} | ConvertTo-Json -Compress
