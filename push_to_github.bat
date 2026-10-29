@echo off
echo ===================================================
echo Pushing LifeLink-Pro to GitHub (Lifelink-BDC)...
echo ===================================================
git push -u origin main
if %ERRORLEVEL% equ 0 (
    echo.
    echo ===================================================
    echo SUCCESS! Repository successfully uploaded to GitHub.
    echo ===================================================
) else (
    echo.
    echo Failed to push. Please check your GitHub authorization.
)
pause
