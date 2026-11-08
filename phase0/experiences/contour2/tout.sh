# Runs the three sets in parallel with the current env; prints the summary lines. Usage: sh tout.sh <tag>
cd "$(dirname "$0")/../.."
S=/c/Users/Thisisme/AppData/Local/Temp/claude/e470baef5a48fb94/ca2c1374-267a-4c14-ab8c-c9fcb8c70c96/scratchpad
for j in reel synth banc; do node experiences/contour2/evaluer.ts --jeux $j --sortie $S/$1-$j.json > $S/$1-$j.log 2>&1 & done; wait
for j in reel synth banc; do sed -n 2p $S/$1-$j.log; done
