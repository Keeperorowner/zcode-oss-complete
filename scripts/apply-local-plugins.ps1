<#
.SYNOPSIS
  把本机已安装 ZCode 的内置插件层（glm/packages + tools/cua-helper）拷进构建目录。

.DESCRIPTION
  这些目录是随官方发行版分发的运行时成品，不属于 zai-org/ZCode 的 Apache-2.0 源码树
  （详见 GAP-REPORT.md）。为了让「从源码构建」的产物具备与官方版一致的插件能力，
  从**你自己本机已安装的 ZCode** 拷贝到构建工作目录，再参与打包。

  本脚本只在本机执行；拷贝结果默认落在 gitignore 的 bundled-resources/ 下，不入库。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\apply-local-plugins.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\apply-local-plugins.ps1 `
      -Source "D:\ZCode\resources" -Target ".\packages\desktop\bundled-resources"

.EXAMPLE
  # 直接覆盖一个已安装/已构建的 ZCode resources 目录
  powershell -ExecutionPolicy Bypass -File .\scripts\apply-local-plugins.ps1 `
      -Target "D:\ZCode\resources"
#>
[CmdletBinding()]
param(
    # 来源：本机已安装 ZCode 的 resources 目录。
    [string]$Source,
    # 目标：构建资源目录（默认 packages/desktop/bundled-resources）或某个已安装 ZCode 的 resources。
    [string]$Target,
    # 只复制 glm/packages（插件层），跳过 tools/cua-helper。
    [switch]$SkipCuaHelper,
    # 打印将要复制的内容但不落盘。
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultSource {
    $candidates = @(
        "D:\ZCode\resources",
        "D:\ZCode\ZCode Preview\resources",
        "C:\Program Files\ZCode\resources",
        "C:\Program Files\ZCode Preview\resources",
        "$env:LOCALAPPDATA\Programs\ZCode\resources",
        "$env:LOCALAPPDATA\Programs\ZCode Preview\resources"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $candidate "glm\packages")) {
            return $candidate
        }
    }
    return $null
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not $Source) {
    $Source = Resolve-DefaultSource
    if (-not $Source) {
        Write-Error "找不到已安装 ZCode 的 resources 目录，请用 -Source 显式指定。"
        exit 1
    }
}
if (-not $Target) {
    $Target = Join-Path $repoRoot "packages\desktop\bundled-resources"
}

$srcPkgs = Join-Path $Source "glm\packages"
$srcCua = Join-Path $Source "tools\cua-helper"

if (-not (Test-Path -LiteralPath $srcPkgs)) {
    Write-Error "源目录缺少 glm\packages: $srcPkgs"
    exit 1
}
if (-not $SkipCuaHelper -and -not (Test-Path -LiteralPath $srcCua)) {
    Write-Error "源目录缺少 tools\cua-helper: $srcCua（如确无 Computer Use 助手，用 -SkipCuaHelper）"
    exit 1
}

Write-Host "Source : $Source"
Write-Host "Target : $Target"
Write-Host ""

$dstPkgs = Join-Path $Target "glm\packages"
Write-Host "[1/3] glm\packages -> $dstPkgs"
if ($WhatIf) {
    Get-ChildItem -LiteralPath $srcPkgs -Directory | ForEach-Object { Write-Host ("  would copy: " + $_.Name) }
}
else {
    New-Item -ItemType Directory -Force -Path $dstPkgs | Out-Null
    Copy-Item -Path (Join-Path $srcPkgs "*") -Destination $dstPkgs -Recurse -Force
    Get-ChildItem -LiteralPath $dstPkgs -Directory | ForEach-Object { Write-Host ("  - " + $_.Name) }
}

if (-not $SkipCuaHelper) {
    Write-Host ""
    Write-Host "[2/3] tools\cua-helper -> $(Join-Path $Target 'tools\cua-helper')"
    if ($WhatIf) {
        Write-Host "  would copy: cua-helper (incl. build/Release/ax_native.node)"
    }
    else {
        $dstTools = Join-Path $Target "tools"
        New-Item -ItemType Directory -Force -Path $dstTools | Out-Null
        Copy-Item -Path $srcCua -Destination $dstTools -Recurse -Force
        Write-Host "  - cua-helper"
    }
}
else {
    Write-Host ""
    Write-Host "[2/3] skipped ( -SkipCuaHelper )"
}

Write-Host ""
Write-Host "[3/3] Done."
if (-not $WhatIf) {
    Write-Host ""
    Write-Host "注意：这些目录是官方发行版的运行时成品，含第三方/受限许可内容"
    Write-Host "（docx/pdf/pptx/xlsx 四个技能为 SEE LICENSE IN ... 全保留），仅供本机自用，不要提交进 Git。"
}
