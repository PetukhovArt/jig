[TestClass]
public class SumTests
{
    [TestMethod, TestCategory("unit")]
    public void Adds() => Assert.AreEqual(2, Sum.Add(1, 1));
}
