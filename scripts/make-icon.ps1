# Génère l'icône de l'appli (build/icon.png, 512x512) avec .NET.
# À relancer seulement si on veut changer l'icône :
#   powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'

# Fond : carré arrondi avec un dégradé bleu → violet
$rect = New-Object System.Drawing.Rectangle 16, 16, ($size - 32), ($size - 32)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 110
$path.AddArc($rect.X, $rect.Y, $r, $r, 180, 90)
$path.AddArc($rect.Right - $r, $rect.Y, $r, $r, 270, 90)
$path.AddArc($rect.Right - $r, $rect.Bottom - $r, $r, $r, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $r, $r, $r, 90, 90)
$path.CloseFigure()
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(79, 140, 255)), ([System.Drawing.Color]::FromArgb(123, 92, 255)), 45
$g.FillPath($brush, $path)

# Une "boîte de jeu" stylisée
$box = New-Object System.Drawing.Rectangle 150, 110, 212, 292
$g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230, 13, 15, 20))), $box)
$g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))), 150, 110, 26, 292)

# Texte "GR"
$font = New-Object System.Drawing.Font 'Segoe UI', 96, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = 'Center'
$format.LineAlignment = 'Center'
$textRect = New-Object System.Drawing.RectangleF 176, 110, 186, 292
$g.DrawString('GR', $font, [System.Drawing.Brushes]::White, $textRect, $format)

$out = Join-Path $PSScriptRoot '..\build\icon.png'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
"Icône générée : $out"
