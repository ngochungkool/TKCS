@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Dang dong bo code moi len GitHub va Web Online (ngochungkool/TKCS)...
git add -A
git commit -m "Cap nhat giao dien va tinh nang moi"
git push origin main
echo.
echo Hoan tat! Trang web Online tren Render se tu dong cap nhat sau ~45 giay.
timeout /t 5
