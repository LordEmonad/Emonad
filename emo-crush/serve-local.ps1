param(
  [int]$Port = 5500
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = "http://localhost:$Port/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webp' = 'image/webp'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
}

function Send-Bytes($ctx, [byte[]]$bytes, [string]$contentType, [int]$statusCode) {
  $ctx.Response.StatusCode = $statusCode
  if ($contentType) { $ctx.Response.ContentType = $contentType }
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.OutputStream.Close()
}

try {
  $listener.Start()
  Write-Host "Serving $root at $prefix"
  Write-Host "Press Ctrl+C to stop."

  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ([string]::IsNullOrWhiteSpace($path) -or $path -eq '/') { $path = '/index.html' }

    $relative = $path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      Send-Bytes $ctx ([System.Text.Encoding]::UTF8.GetBytes('Forbidden')) 'text/plain; charset=utf-8' 403
      continue
    }

    if (-not (Test-Path $full -PathType Leaf)) {
      Send-Bytes $ctx ([System.Text.Encoding]::UTF8.GetBytes('Not Found')) 'text/plain; charset=utf-8' 404
      continue
    }

    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $contentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    Send-Bytes $ctx $bytes $contentType 200
  }
}
finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
