[TestFixture]
public class SumTests
{
    [TestInitialize]
    public void Init() => _cases = Cases[Test];

    [TestCategory("unit")]
    public int Count => _cases.Length;
}
