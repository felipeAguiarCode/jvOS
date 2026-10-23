# jvfetch: this machine at a glance, JARVIS style (in the spirit of neofetch / winfetch).
# jv_sh installs it and puts its launchers on the PATH of every tab (jvfetch.cmd for PowerShell and
# cmd, jvfetch for Git Bash and WSL). Inside jv_sh the colours are ANSI palette slots that jv_sh maps
# to the JARVIS theme, so they follow the theme live; anywhere else they are the default blue.

$ErrorActionPreference = "SilentlyContinue"
$previousEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false

try {
    $esc = [char]27
    $reset = "$esc[0m"
    $bold = "$esc[1m"
    if ($env:JARVIS_SH) {
        # jv_sh's palette: blue = accent, cyan = light, white = text, bright black = dim, red = alert.
        $accent = "$esc[34m"; $light = "$esc[36m"; $text = "$esc[37m"; $dim = "$esc[90m"; $alert = "$esc[31m"
    } else {
        $accent = "$esc[38;2;0;202;253m"; $light = "$esc[38;2;118;243;255m"; $text = "$esc[38;2;168;219;229m"
        $dim = "$esc[38;2;92;104;115m"; $alert = "$esc[38;2;255;93;93m"
    }

    # --- The facts: the registry where it is instant, CIM (only the needed properties) elsewhere --
    $os = Get-CimInstance Win32_OperatingSystem -Property Caption, OSArchitecture, LastBootUpTime, TotalVisibleMemorySize, FreePhysicalMemory
    $nt = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
    $bios = Get-ItemProperty "HKLM:\HARDWARE\DESCRIPTION\System\BIOS"
    $cpu = Get-CimInstance Win32_Processor -Property Name, NumberOfCores, NumberOfLogicalProcessors | Select-Object -First 1
    $gpus = @(Get-CimInstance Win32_VideoController -Property Name, CurrentHorizontalResolution, CurrentVerticalResolution, CurrentRefreshRate | Where-Object { $_.Name })
    $battery = Get-CimInstance Win32_Battery -Property EstimatedChargeRemaining, BatteryStatus | Select-Object -First 1
    $disk = [IO.DriveInfo]::new("$env:SystemDrive".Substring(0, 1))
    $settingsPath = if ($env:JARVIS_SETTINGS) { $env:JARVIS_SETTINGS } else { Join-Path $env:APPDATA "dev.jarvis.os\settings.json" }
    $jarvis = if (Test-Path $settingsPath) { Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json }

    function Size([double]$bytes) {
        if ($bytes -ge 1TB) { "{0:N1} TB" -f ($bytes / 1TB) } else { "{0:N1} GB" -f ($bytes / 1GB) }
    }
    # A gauge: the share filled in accent, the rest dim. Doubles throughout: [math]::Min(1, 0.4)
    # would pick the int overload and round to 0.
    function Gauge([double]$share) {
        $cells = 12
        $filled = [int][math]::Round([math]::Max(0.0, [math]::Min(1.0, $share)) * $cells)
        $accent + ("■" * $filled) + $dim + ("·" * ($cells - $filled)) + $reset + $text + (" {0,3:N0}%" -f ($share * 100))
    }

    $uptime = (Get-Date) - $os.LastBootUpTime
    $since = @()
    if ($uptime.Days) { $since += "$($uptime.Days)d" }
    if ($uptime.Hours) { $since += "$($uptime.Hours)h" }
    $since += "$($uptime.Minutes)min"

    $system = "$($os.Caption)" -replace '^Microsoft ', ''
    if ($nt.DisplayVersion) { $system += " $($nt.DisplayVersion)" }
    $build = "$($nt.CurrentBuild)" + $(if ($nt.UBR) { ".$($nt.UBR)" } else { "" })

    $memoryTotal = [double]$os.TotalVisibleMemorySize * 1KB
    $memoryUsed = $memoryTotal - [double]$os.FreePhysicalMemory * 1KB
    $memoryShare = if ($memoryTotal) { $memoryUsed / $memoryTotal } else { 0 }
    $diskUsed = [double]$disk.TotalSize - [double]$disk.AvailableFreeSpace
    $diskShare = if ($disk.TotalSize) { $diskUsed / $disk.TotalSize } else { 0 }
    $diskName = "$($disk.Name)".TrimEnd('\')
    $screen = $gpus | Where-Object { $_.CurrentHorizontalResolution } | Select-Object -First 1
    $size = $Host.UI.RawUI.WindowSize

    $themes = @{ blue = "azul"; green = "verde"; yellow = "amarelo"; custom = "personalizado" }
    $modes = @{ pushToTalk = "segurar para falar"; wakeWord = "Hey Jarvis"; always = "sempre ouvindo" }

    # What JARVIS would point out first.
    $warnings = @()
    if ($diskShare -ge 0.9) { $warnings += "disco $diskName quase cheio ($(Size $disk.AvailableFreeSpace) livres)" }
    if ($memoryShare -ge 0.9) { $warnings += "memória perto do limite" }
    if ($battery -and $battery.BatteryStatus -ne 2 -and $battery.EstimatedChargeRemaining -le 20) { $warnings += "bateria baixa, conecte o carregador" }

    # --- The rows ----------------------------------------------------------------------------
    $user = "$env:USERNAME".ToLower()
    $machine = "$env:COMPUTERNAME".ToLower()
    $rows = New-Object Collections.ArrayList
    function Row([string]$label, [string]$value) { [void]$rows.Add(@($label, $value)) }
    Row "" "$bold$light$user$reset$dim@$reset$bold$light$machine$reset"
    Row "" "$dim$('─' * ($user.Length + $machine.Length + 1))$reset"
    Row "sistema" "$system · $($os.OSArchitecture)"
    Row "build" $build
    Row "máquina" "$($bios.SystemManufacturer) $($bios.SystemProductName)".Trim()
    Row "ligado há" ($since -join " ")
    if ($env:JARVIS_SHELL) { Row "shell" $env:JARVIS_SHELL }
    if ($env:JARVIS_SH) { Row "terminal" $(if ($size.Width) { "jv_sh · $($size.Width)×$($size.Height)" } else { "jv_sh" }) }
    if ($screen) { Row "tela" "$($screen.CurrentHorizontalResolution)×$($screen.CurrentVerticalResolution) · $($screen.CurrentRefreshRate) Hz" }
    Row "cpu" "$("$($cpu.Name)" -replace '\((R|TM)\)', '' -replace '\s+', ' ') · $($cpu.NumberOfCores)c/$($cpu.NumberOfLogicalProcessors)t"
    foreach ($gpu in $gpus) { Row "gpu" ("$($gpu.Name)" -replace '\((R|TM)\)', '') }
    Row "memória" "$(Gauge $memoryShare) · $(Size $memoryUsed) / $(Size $memoryTotal)"
    if ($disk.TotalSize) { Row "disco $diskName" "$(Gauge $diskShare) · $(Size $diskUsed) / $(Size $disk.TotalSize)" }
    if ($battery) {
        Row "bateria" ("$(Gauge ($battery.EstimatedChargeRemaining / 100))" + $(if ($battery.BatteryStatus -eq 2) { " · na tomada" } else { "" }))
    }
    if ($jarvis) {
        $version = if ($env:JARVIS_VERSION) { "v$env:JARVIS_VERSION · " } else { "" }
        Row "jarvis" "${version}tema $($themes["$($jarvis.theme)"]) · whisper $($jarvis.model) · $($modes["$($jarvis.activation)"])"
    }
    Row "" ""
    if ($warnings.Count) {
        foreach ($warning in $warnings) { Row "" "$alert▲ $warning$reset" }
    } else {
        Row "" "$light▸ todos os sistemas operacionais.$reset"
    }
    Row "" ""
    Row "" (((0..7 | ForEach-Object { "$esc[4${_}m   " }) -join "") + $reset)
    Row "" (((0..7 | ForEach-Object { "$esc[10${_}m   " }) -join "") + $reset)

    # --- The emblem: the hologram's rings, drawn from distances (a cell is ~2x taller than wide) --
    $width = 29; $height = 15
    $cx = ($width - 1) / 2; $cy = ($height - 1) / 2
    $emblem = New-Object Collections.ArrayList
    for ($y = 0; $y -lt $height; $y++) {
        $line = ""
        for ($x = 0; $x -lt $width; $x++) {
            $dx = ($x - $cx) / 2.0; $dy = $y - $cy
            $d = [math]::Sqrt($dx * $dx + $dy * $dy)
            # 0..1 around the circle, starting at nine o'clock.
            $turn = ([math]::Atan2($dy, $dx) + [math]::PI) / (2 * [math]::PI)
            $cell = ""
            if ([math]::Abs($d - 6.6) -lt 0.5) {
                # Outer ring: four arcs with gaps, like the hologram's.
                $quarter = ($turn * 4) % 1
                if ($quarter -gt 0.14 -and $quarter -lt 0.86) { $cell = "$accent█" }
            } elseif ([math]::Abs($d - 4.9) -lt 0.4) {
                # Middle ring: a dotted orbit.
                if (($x + $y) % 2 -eq 0) { $cell = "$dim•" }
            } elseif ([math]::Abs($d - 3.3) -lt 0.45) {
                $cell = "$light▓"
            } elseif ($d -lt 1.25) {
                $cell = "$bold$light█"
            } elseif ([math]::Abs($dy) -lt 0.5 -and $d -lt 2.8) {
                $cell = "$accent─"
            }
            $line += if ($cell) { "$cell$reset" } else { " " }
        }
        [void]$emblem.Add($line)
    }
    $title = "J · A · R · V · I · S"
    $pad = [math]::Floor(($width - $title.Length) / 2)
    [void]$emblem.Add(" " * $width)
    [void]$emblem.Add((" " * $pad) + "$bold$light$title$reset" + (" " * ($width - $title.Length - $pad)))

    # --- Side by side, each column centred on the other; a narrow tab gets the facts alone ------
    $widest = ($rows | ForEach-Object { ("$($_[0])".PadRight(11) + $_[1]) -replace "$esc\[[0-9;]*m", "" } | Measure-Object -Property Length -Maximum).Maximum
    $gap = "    "
    if ($size.Width -and 2 + $width + 4 + $widest -gt $size.Width) {
        $emblem.Clear(); $width = 0; $gap = ""
    }
    $lines = [math]::Max($emblem.Count, $rows.Count)
    $emblemTop = [math]::Floor(($lines - $emblem.Count) / 2)
    $rowsTop = [math]::Floor(($lines - $rows.Count) / 2)
    $out = New-Object Text.StringBuilder
    [void]$out.AppendLine()
    for ($i = 0; $i -lt $lines; $i++) {
        $at = $i - $emblemTop
        $left = if ($at -ge 0 -and $at -lt $emblem.Count) { $emblem[$at] } else { " " * $width }
        $right = ""
        $at = $i - $rowsTop
        if ($at -ge 0 -and $at -lt $rows.Count) {
            $label = $rows[$at][0]; $value = $rows[$at][1]
            $right = if ($label) { "$bold$accent$($label.PadRight(11))$reset$text$value$reset" } else { $value }
        }
        [void]$out.AppendLine("  $left$gap$right".TrimEnd())
    }
    [Console]::Out.Write($out.ToString())
}
finally {
    [Console]::OutputEncoding = $previousEncoding
}
