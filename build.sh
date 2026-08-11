AEBHASH=$(git rev-parse --short HEAD)
docker build -t darkcheyenne/KGV-Errinnerung:$AEBHASH .