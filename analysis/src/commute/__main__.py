import argparse

from commute.pipeline import run


def main() -> None:
    parser = argparse.ArgumentParser(prog="commute", description="Bicycle commute analysis pipeline")
    parser.add_argument("--cv-repeats", type=int, default=5)
    parser.add_argument("--bootstrap-reps", type=int, default=300)
    parser.add_argument("--conformal-reps", type=int, default=60)
    args = parser.parse_args()
    run(cv_repeats=args.cv_repeats, bootstrap_reps=args.bootstrap_reps, conformal_reps=args.conformal_reps)


if __name__ == "__main__":
    main()
